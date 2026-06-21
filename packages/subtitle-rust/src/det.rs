//! DB (Differentiable Binarization) post-processing.
//!
//! Pipeline (matches the C++ implementation):
//!   1. Apply sigmoid (if values are logits) → probability map.
//!   2. `prob[i] > thr` → 8-bit bitmap.
//!   3. 2×2 dilate to reconnect thin regions (matches Python `use_dilation`).
//!   4. Connected components (4-neighbors).
//!   5. For each component: trace contour → take every-other point → fit
//!      minimum area rotated rectangle → unclip by the standard formula
//!      `dist = w*h*unclip_ratio / (2*(w+h))` to recover the pre-contraction
//!      box that DB networks predict.
//!   6. Score = average probability inside the box (rotated rectangle).
//!   7. Drop boxes with score < box_threshold.

use crate::image::Point;

const DET_THRESH: f32 = 0.3;
const UNCLIP_RATIO: f32 = 1.6;
const MAX_CANDIDATES: usize = 1000;

pub struct DetBox {
    pub polygon: [Point; 4],
    pub score: f32,
}

/// Minimum area rotated rectangle.
#[derive(Copy, Clone, Debug)]
struct RotatedRect {
    cx: f32,
    cy: f32,
    width: f32,
    height: f32,
    angle_deg: f32,
}

/// Find the minimum-area rotated rectangle enclosing a simple polygon.
/// Implemented via rotating calipers over the convex hull.
fn convex_hull(mut pts: Vec<Point>) -> Vec<Point> {
    pts.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap().then(a.y.partial_cmp(&b.y).unwrap()));
    // Monotone chain (Andrew's algorithm).
    let n = pts.len();
    if n <= 1 { return pts; }
    let cross = |o: Point, a: Point, b: Point| {
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    };
    let mut hull = Vec::with_capacity(n + 1);
    for &p in &pts {
        while hull.len() >= 2 && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(p);
    }
    let lower = hull.len();
    for i in (0..n - 1).rev() {
        let p = pts[i];
        while hull.len() > lower && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(p);
    }
    hull.pop();
    hull
}

fn min_area_rect(hull: &[Point]) -> RotatedRect {
    let n = hull.len();
    if n == 0 {
        return RotatedRect { cx: 0.0, cy: 0.0, width: 1.0, height: 1.0, angle_deg: 0.0 };
    }
    if n == 1 {
        return RotatedRect { cx: hull[0].x, cy: hull[0].y, width: 1.0, height: 1.0, angle_deg: 0.0 };
    }
    if n == 2 {
        let dx = hull[1].x - hull[0].x;
        let dy = hull[1].y - hull[0].y;
        let len = (dx * dx + dy * dy).sqrt();
        return RotatedRect {
            cx: (hull[0].x + hull[1].x) * 0.5,
            cy: (hull[0].y + hull[1].y) * 0.5,
            width: len.max(1.0),
            height: 1.0,
            angle_deg: dy.atan2(dx).to_degrees(),
        };
    }

    // Rotating calipers: for each edge of the hull, compute extents in a
    // coordinate system aligned with that edge.
    let mut best_area = f32::INFINITY;
    let mut best = RotatedRect { cx: 0.0, cy: 0.0, width: 1.0, height: 1.0, angle_deg: 0.0 };

    for i in 0..n {
        let a = hull[i];
        let b = hull[(i + 1) % n];
        let ex = b.x - a.x;
        let ey = b.y - a.y;
        let len = (ex * ex + ey * ey).sqrt();
        if len < 1e-6 { continue; }
        let ux = ex / len;
        let uy = ey / len;
        // perpendicular: (-uy, ux)
        let vx = -uy;
        let vy = ux;

        let mut min_u = f32::INFINITY;
        let mut max_u = f32::NEG_INFINITY;
        let mut min_v = f32::INFINITY;
        let mut max_v = f32::NEG_INFINITY;
        for p in hull {
            let u = p.x * ux + p.y * uy;
            let v = p.x * vx + p.y * vy;
            if u < min_u { min_u = u; }
            if u > max_u { max_u = u; }
            if v < min_v { min_v = v; }
            if v > max_v { max_v = v; }
        }
        let w = max_u - min_u;
        let h = max_v - min_v;
        let area = w * h;
        if area < best_area {
            best_area = area;
            // Rectangle center in local (u, v):
            let cu = (min_u + max_u) * 0.5;
            let cv = (min_v + max_v) * 0.5;
            let cx = cu * ux + cv * vx;
            let cy = cu * uy + cv * vy;
            // Angle in standard convention: align with the edge direction.
            // Use a canonical (-90, 0] range to match OpenCV conventions.
            let mut angle = uy.atan2(ux).to_degrees();
            while angle > 0.0 { angle -= 180.0; }
            while angle <= -90.0 { angle += 180.0; }
            best = RotatedRect { cx, cy, width: w.max(1.0), height: h.max(1.0), angle_deg: angle };
        }
    }
    best
}

/// Rotated rectangle -> 4 corners (TL, TR, BR, BL order).
fn box_points(rect: RotatedRect) -> [Point; 4] {
    let a = rect.angle_deg.to_radians();
    let (cos_a, sin_a) = (a.cos(), a.sin());
    let hw = rect.width * 0.5;
    let hh = rect.height * 0.5;
    // Local corners before rotation/translation.
    let l = [
        Point { x: -hw, y: -hh },
        Point { x:  hw, y: -hh },
        Point { x:  hw, y:  hh },
        Point { x: -hw, y:  hh },
    ];
    let mut out = [Point { x: 0.0, y: 0.0 }; 4];
    for (i, &p) in l.iter().enumerate() {
        let rx = p.x * cos_a - p.y * sin_a + rect.cx;
        let ry = p.x * sin_a + p.y * cos_a + rect.cy;
        out[i] = Point { x: rx, y: ry };
    }
    out
}

/// Average value inside a rotated rectangle, with bounds checking.
fn box_score(prob: &[f32], w: usize, h: usize, rect: RotatedRect) -> f32 {
    // Sample along the rectangle using an axis-aligned bounding box.
    let mut buf = [Point { x: 0.0, y: 0.0 }; 4];
    for (i, b) in box_points(rect).iter().enumerate() { buf[i] = *b; }
    let xmin = buf.iter().map(|p| p.x).fold(f32::INFINITY, f32::min).floor() as i32;
    let xmax = buf.iter().map(|p| p.x).fold(f32::NEG_INFINITY, f32::max).ceil() as i32;
    let ymin = buf.iter().map(|p| p.y).fold(f32::INFINITY, f32::min).floor() as i32;
    let ymax = buf.iter().map(|p| p.y).fold(f32::NEG_INFINITY, f32::max).ceil() as i32;

    let (cx, cy) = (rect.cx, rect.cy);
    let a = rect.angle_deg.to_radians();
    let (cos_a, sin_a) = (a.cos(), a.sin());
    let hw = rect.width * 0.5;
    let hh = rect.height * 0.5;

    let mut sum = 0.0f64;
    let mut count: i64 = 0;
    for y in ymin..=ymax {
        for x in xmin..=xmax {
            let dx = (x as f32) - cx;
            let dy = (y as f32) - cy;
            let lx = dx * cos_a + dy * sin_a;
            let ly = -dx * sin_a + dy * cos_a;
            if lx < -hw || lx > hw || ly < -hh || ly > hh { continue; }
            let xi = x.clamp(0, w as i32 - 1) as usize;
            let yi = y.clamp(0, h as i32 - 1) as usize;
            sum += prob[yi * w + xi] as f64;
            count += 1;
        }
    }
    if count == 0 { 0.0 } else { (sum / count as f64) as f32 }
}

pub fn db_postprocess(
    heatmap: &[f32],
    hm_w: usize,
    hm_h: usize,
    orig_w: usize,
    orig_h: usize,
    box_thresh: f32,
) -> Vec<DetBox> {
    // 1. Normalize: if values exceed 1.0 anywhere, apply sigmoid (treat as
    //    logits). Otherwise treat as probabilities.
    let sigmoid = heatmap.iter().any(|&v| v > 1.0);
    let prob: Vec<f32> = if sigmoid {
        heatmap.iter().map(|&v| 1.0 / (1.0 + (-v).exp())).collect()
    } else {
        heatmap.to_vec()
    };

    // (diagnostic) rough distribution of the probability map.
    {
        let mut max_val = 0.0f32;
        let mut over_03 = 0u64;
        let mut sum = 0.0f64;
        for &p in prob.iter() {
            if p > max_val { max_val = p; }
            if p > DET_THRESH { over_03 += 1; }
            sum += p as f64;
        }
        eprintln!(
            "[DB] sigmoid={}, max={:.4}, mean={:.4}, over_thr={}/{}",
            sigmoid,
            max_val,
            sum / (prob.len() as f64),
            over_03,
            prob.len(),
        );
    }

    // 2. Bitmap
    let mut bitmap = vec![0u8; hm_w * hm_h];
    for i in 0..hm_w * hm_h {
        if prob[i] > DET_THRESH { bitmap[i] = 1; }
    }

    // 3. 2×2 dilate
    let mut dilated = vec![0u8; hm_w * hm_h];
    for y in 0..hm_h {
        for x in 0..hm_w {
            if bitmap[y * hm_w + x] == 1 {
                dilated[y * hm_w + x] = 1;
                if x + 1 < hm_w { dilated[y * hm_w + x + 1] = 1; }
                if y + 1 < hm_h { dilated[(y + 1) * hm_w + x] = 1; }
                if x + 1 < hm_w && y + 1 < hm_h { dilated[(y + 1) * hm_w + x + 1] = 1; }
            }
        }
    }

    // 4. Connected components (4-connectivity, with a 1-pass scan + union
    //    of equal labels). We use a simple label-matrix scan.
    let (labels, num_labels) = connected_components(&dilated, hm_w, hm_h);

    // 5. Gather components as lists of (x, y) points.
    let mut comps: Vec<Vec<Point>> = vec![Vec::new(); num_labels as usize];
    for y in 0..hm_h {
        for x in 0..hm_w {
            let l = labels[y * hm_w + x];
            if l > 0 {
                comps[l as usize - 1].push(Point { x: x as f32, y: y as f32 });
            }
        }
    }
    // Sort by size (largest first) to honor MAX_CANDIDATES.
    comps.sort_by(|a, b| b.len().cmp(&a.len()));

    let mut out: Vec<DetBox> = Vec::new();
    let n = comps.len().min(MAX_CANDIDATES);

    eprintln!("[DB] components={}, top5_sizes={:?}", comps.len(), comps.iter().take(5).map(|c| c.len()).collect::<Vec<_>>());

    for comp in &comps[..n] {
        if comp.len() < 4 { continue; }
        // Contour: we take the convex hull of the component's pixels. (A
        // proper contour trace would be cheaper, but for small heatmaps the
        // hull approach is fast enough and gives a tight polygon.)
        let hull = convex_hull(comp.clone());
        if hull.len() < 3 { continue; }
        let rect = min_area_rect(&hull);
        let short = rect.width.min(rect.height);
        if short < 3.0 { continue; }

        let score = box_score(&prob, hm_w, hm_h, rect);
        eprintln!("[DB] comp size={}, hull={}, rect=({:.1}x{:.1} @ {:.1} deg), score={:.4}", comp.len(), hull.len(), rect.width, rect.height, rect.angle_deg, score);
        if score < box_thresh { continue; }

        // Unclip: distance computed from area and perimeter of the rotated
        // rect. `dist = w*h * unclip_ratio / (2*(w+h))` with a small safety
        // floor.
        let dist = (rect.width * rect.height * UNCLIP_RATIO) / (2.0 * (rect.width + rect.height));
        let dist = dist.max(3.0);
        let unclipped = RotatedRect {
            cx: rect.cx, cy: rect.cy,
            width: rect.width + 2.0 * dist,
            height: rect.height + 2.0 * dist,
            angle_deg: rect.angle_deg,
        };
        if unclipped.width.min(unclipped.height) < 5.0 { continue; }

        // Remap from heatmap coordinates → original ROI coordinates.
        let sx = orig_w as f32 / hm_w as f32;
        let sy = orig_h as f32 / hm_h as f32;
        let unclipped = RotatedRect {
            cx: unclipped.cx * sx,
            cy: unclipped.cy * sy,
            width: unclipped.width * sx,
            height: unclipped.height * sy,
            angle_deg: unclipped.angle_deg,
        };
        let pts = box_points(unclipped);
        let mut clipped = [Point { x: 0.0, y: 0.0 }; 4];
        for (i, p) in pts.iter().enumerate() {
            clipped[i] = Point {
                x: p.x.clamp(0.0, (orig_w - 1) as f32),
                y: p.y.clamp(0.0, (orig_h - 1) as f32),
            };
        }
        out.push(DetBox { polygon: clipped, score });
    }
    out
}

fn connected_components(img: &[u8], w: usize, h: usize) -> (Vec<i32>, i32) {
    // 4-connectivity, simple two-pass with union-find.
    let n = w * h;
    let mut labels = vec![0i32; n];
    let mut parent: Vec<i32> = vec![0]; // parent[0] unused (0 = background)

    // Pass 1: scan + union with top/left neighbors.
    let mut next_label = 1i32;

    fn find(parent: &mut [i32], mut x: i32) -> i32 {
        let root = {
            let mut r = x;
            while parent[r as usize] != r { r = parent[r as usize]; }
            r
        };
        while parent[x as usize] != root {
            let next = parent[x as usize];
            parent[x as usize] = root;
            x = next;
        }
        root
    }

    for y in 0..h {
        for x in 0..w {
            let idx = y * w + x;
            if img[idx] == 0 { continue; }
            let mut neighbors = [0i32; 2];
            let mut has = 0usize;
            if x > 0 && img[idx - 1] != 0 {
                let l = labels[idx - 1];
                neighbors[has] = l;
                has += 1;
            }
            if y > 0 && img[idx - w] != 0 {
                let l = labels[idx - w];
                neighbors[has] = l;
                has += 1;
            }
            if has == 0 {
                let l = next_label;
                next_label += 1;
                parent.push(l);
                labels[idx] = l;
            } else {
                // Union the labels, then assign the minimum root.
                let r0 = find(&mut parent, neighbors[0]);
                let r1 = if has > 1 { find(&mut parent, neighbors[1]) } else { r0 };
                if r0 != r1 {
                    let root = r0.min(r1);
                    let other = if r0 == root { r1 } else { r0 };
                    parent[other as usize] = root;
                }
                labels[idx] = find(&mut parent, r0);
            }
        }
    }
    // Pass 2: compact labels so final labels are 1..k.
    let mut compact = vec![0i32; next_label as usize];
    let mut k = 0i32;
    for i in 1..next_label as usize {
        let r = find(&mut parent, i as i32);
        if compact[r as usize] == 0 {
            k += 1;
            compact[r as usize] = k;
        }
        if r != i as i32 {
            compact[i] = compact[r as usize];
        }
    }
    for v in labels.iter_mut() {
        if *v != 0 { *v = compact[*v as usize]; }
    }
    (labels, k)
}
