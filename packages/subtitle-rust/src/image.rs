//! Image utilities (replacement for C++ image.h).
//!
//! Loads PNG/JPEG via the `image` crate into an in-memory RGB buffer, and
//! provides geometric helpers used by the OCR pipeline: bilinear resize, 180°
//! rotation, and perspective-warp crop (for pulling text regions out of the
//! original frame).

use std::path::Path;

/// 3-channel, 8-bit per channel RGB image. Pixels are laid out row-major.
#[derive(Clone)]
pub struct Image {
    pub w: usize,
    pub h: usize,
    /// Length = `w * h * 3`. Pixel at (x, y) starts at `(y * w + x) * 3` and
    /// is stored as (r, g, b).
    pub data: Vec<u8>,
}

impl Image {
    pub fn new(w: usize, h: usize) -> Self {
        Self { w, h, data: vec![0u8; w * h * 3] }
    }

    /// Load from path. Converts any supported input to RGB8.
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let img = image::open(path.as_ref())
            .map_err(|e| format!("load image failed: {}", e))?;
        let rgb = img.to_rgb8();
        let (w, h) = (rgb.width() as usize, rgb.height() as usize);
        Ok(Self { w, h, data: rgb.into_raw() })
    }
}

/// Bilinear sample. `sx`, `sy` are in pixels, clamped to image bounds.
pub fn sample_bilinear(img: &Image, sx: f32, sy: f32, ch: usize) -> f32 {
    let x0 = sx.floor();
    let y0 = sy.floor();
    let fx = sx - x0;
    let fy = sy - y0;
    let x0i = x0 as i32;
    let y0i = y0 as i32;
    let w = img.w as i32;
    let h = img.h as i32;

    let mut sum = 0.0f32;
    for dy in 0i32..2 {
        let yy = (y0i + dy).clamp(0, h - 1) as usize;
        let wy = if dy == 0 { 1.0 - fy } else { fy };
        for dx in 0i32..2 {
            let xx = (x0i + dx).clamp(0, w - 1) as usize;
            let wx = if dx == 0 { 1.0 - fx } else { fx };
            let idx = (yy * img.w + xx) * 3 + ch;
            sum += img.data[idx] as f32 * wx * wy;
        }
    }
    sum
}

/// Resize src (src_w x src_h) into dst (dst_w x dst_h) using bilinear
/// interpolation. Both are RGB, stride 3.
pub fn resize_bilinear(
    src: &[u8], src_w: usize, src_h: usize,
    dst: &mut [u8], dst_w: usize, dst_h: usize,
) {
    let scale_x = src_w as f32 / dst_w as f32;
    let scale_y = src_h as f32 / dst_h as f32;
    for y in 0..dst_h {
        let src_y = (y as f32 + 0.5) * scale_y - 0.5;
        let y0 = src_y.floor();
        let fy = src_y - y0;
        let y0i = y0 as i32;
        for x in 0..dst_w {
            let src_x = (x as f32 + 0.5) * scale_x - 0.5;
            let x0 = src_x.floor();
            let fx = src_x - x0;
            let x0i = x0 as i32;
            for ch in 0..3 {
                let mut sum = 0.0f32;
                for dy in 0i32..2 {
                    let yy = (y0i + dy).clamp(0, src_h as i32 - 1) as usize;
                    let wy = if dy == 0 { 1.0 - fy } else { fy };
                    for dx in 0i32..2 {
                        let xx = (x0i + dx).clamp(0, src_w as i32 - 1) as usize;
                        let wx = if dx == 0 { 1.0 - fx } else { fx };
                        let idx = (yy * src_w + xx) * 3 + ch;
                        sum += src[idx] as f32 * wx * wy;
                    }
                }
                let di = (y * dst_w + x) * 3 + ch;
                dst[di] = sum.clamp(0.0, 255.0) as u8;
            }
        }
    }
}

pub fn rotate_180(img: &Image) -> Image {
    let mut out = Image::new(img.w, img.h);
    for y in 0..img.h {
        for x in 0..img.w {
            let src_y = img.h - 1 - y;
            let src_x = img.w - 1 - x;
            let src_idx = (src_y * img.w + src_x) * 3;
            let dst_idx = (y * img.w + x) * 3;
            out.data[dst_idx] = img.data[src_idx];
            out.data[dst_idx + 1] = img.data[src_idx + 1];
            out.data[dst_idx + 2] = img.data[src_idx + 2];
        }
    }
    out
}

/// 2D point with float coordinates (subpixel).
#[derive(Copy, Clone, Debug)]
pub struct Point { pub x: f32, pub y: f32 }

/// Perspective-warp crop: maps source 4-point polygon to a rectangle of size
/// (out_w, out_h), pulling pixels from `img` via bilinear sampling. Matches
/// the C++ `warpPerspectiveCrop` and Python rapidocr `get_rotate_crop_image`.
pub fn warp_perspective_crop(img: &Image, pts: &[Point; 4]) -> Image {
    let xs: [f32; 4] = [pts[0].x, pts[1].x, pts[2].x, pts[3].x];
    let ys: [f32; 4] = [pts[0].y, pts[1].y, pts[2].y, pts[3].y];
    let w1 = ((xs[1] - xs[0]).powi(2) + (ys[1] - ys[0]).powi(2)).sqrt();
    let w2 = ((xs[2] - xs[3]).powi(2) + (ys[2] - ys[3]).powi(2)).sqrt();
    let h1 = ((xs[3] - xs[0]).powi(2) + (ys[3] - ys[0]).powi(2)).sqrt();
    let h2 = ((xs[2] - xs[1]).powi(2) + (ys[2] - ys[1]).powi(2)).sqrt();

    let dst_w = 4.max(w1.max(w2).round() as usize);
    let dst_h = 4.max(h1.max(h2).round() as usize);
    let rotate90 = (dst_h as f32) / (dst_w as f32) >= 1.5;
    let (out_w, out_h) = if rotate90 { (dst_h, dst_h) } else { (dst_w, dst_h) };

    // Solve 8x8 perspective transform:
    //   dst corners (u0,v0)=TL, (u1,v1)=TR, (u2,v2)=BR, (u3,v3)=BL
    //   -> source corners pts[0..3] (TL, TR, BR, BL)
    let (u0, v0) = (0.0_f64, 0.0_f64);
    let (u1, v1) = ((dst_w - 1) as f64, 0.0_f64);
    let (u2, v2) = ((dst_w - 1) as f64, (dst_h - 1) as f64);
    let (u3, v3) = (0.0_f64, (dst_h - 1) as f64);
    let (x0, y0) = (pts[0].x as f64, pts[0].y as f64);
    let (x1, y1) = (pts[1].x as f64, pts[1].y as f64);
    let (x2, y2) = (pts[2].x as f64, pts[2].y as f64);
    let (x3, y3) = (pts[3].x as f64, pts[3].y as f64);

    // 8 equations in unknowns a-h where x = (a*u + b*v + c) / (g*u + h*v + 1),
    // y = (d*u + e*v + f) / (g*u + h*v + 1). In matrix form M*unknowns = rhs.
    let mut m: [[f64; 9]; 8] = [
        [u0, v0, 1.0, 0.0, 0.0, 0.0, -u0*x0, -v0*x0, x0],
        [u1, v1, 1.0, 0.0, 0.0, 0.0, -u1*x1, -v1*x1, x1],
        [u2, v2, 1.0, 0.0, 0.0, 0.0, -u2*x2, -v2*x2, x2],
        [u3, v3, 1.0, 0.0, 0.0, 0.0, -u3*x3, -v3*x3, x3],
        [0.0, 0.0, 0.0, u0, v0, 1.0, -u0*y0, -v0*y0, y0],
        [0.0, 0.0, 0.0, u1, v1, 1.0, -u1*y1, -v1*y1, y1],
        [0.0, 0.0, 0.0, u2, v2, 1.0, -u2*y2, -v2*y2, y2],
        [0.0, 0.0, 0.0, u3, v3, 1.0, -u3*y3, -v3*y3, y3],
    ];

    // Gaussian elimination with partial pivoting
    for i in 0..8 {
        // Find pivot
        let mut max_row = i;
        let mut max_val = m[i][i].abs();
        for k in (i + 1)..8 {
            let v = m[k][i].abs();
            if v > max_val { max_val = v; max_row = k; }
        }
        if max_row != i {
            m.swap(i, max_row);
        }
        let pivot = m[i][i];
        if pivot.abs() < 1e-10 {
            // Fallback: axis-aligned crop (shouldn't happen for well-formed boxes)
            let xmin = xs[0].min(xs[1]).min(xs[2]).min(xs[3]).floor() as i32;
            let xmax = xs[0].max(xs[1]).max(xs[2]).max(xs[3]).ceil() as i32;
            let ymin = ys[0].min(ys[1]).min(ys[2]).min(ys[3]).floor() as i32;
            let ymax = ys[0].max(ys[1]).max(ys[2]).max(ys[3]).ceil() as i32;
            let xmin = xmin.max(0) as usize;
            let xmax = (xmax as usize).min(img.w);
            let ymin = ymin.max(0) as usize;
            let ymax = (ymax as usize).min(img.h);
            let w = (xmax - xmin).max(1);
            let h = (ymax - ymin).max(1);
            let mut out = Image::new(w, h);
            for y in 0..h {
                for x in 0..w {
                    let si = ((y + ymin) * img.w + (x + xmin)) * 3;
                    let di = (y * w + x) * 3;
                    out.data[di] = img.data[si];
                    out.data[di + 1] = img.data[si + 1];
                    out.data[di + 2] = img.data[si + 2];
                }
            }
            return out;
        }
        for j in 0..9 { m[i][j] /= pivot; }
        for k in 0..8 {
            if k != i && m[k][i].abs() > 1e-10 {
                let factor = m[k][i];
                for j in 0..9 { m[k][j] -= factor * m[i][j]; }
            }
        }
    }
    let a = m[0][8]; let b = m[1][8]; let c = m[2][8];
    let d = m[3][8]; let e = m[4][8]; let f = m[5][8];
    let g = m[6][8]; let h_coef = m[7][8];

    let mut out = Image::new(out_w, out_h);
    for dy in 0..out_h {
        for dx in 0..out_w {
            let (u, v) = if rotate90 {
                ((dst_w - 1 - dy) as f64, dx as f64)
            } else {
                (dx as f64, dy as f64)
            };
            let denom = g * u + h_coef * v + 1.0;
            let sx = (a * u + b * v + c) / denom;
            let sy = (d * u + e * v + f) / denom;
            let di = (dy * out_w + dx) * 3;
            for ch in 0..3 {
                let val = sample_bilinear(img, sx as f32, sy as f32, ch);
                out.data[di + ch] = val.clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

/// Order 4 points clockwise: TL (top-left), TR (top-right), BR (bottom-right),
/// BL (bottom-left). Matches C++ `orderPointsClockwise`.
pub fn order_points_clockwise(pts: &[Point; 4]) -> [Point; 4] {
    // Sort by x; the two leftmost are TL/BL (sorted by y), the two rightmost
    // are TR/BR (sorted by y).
    let mut idx: [usize; 4] = [0, 1, 2, 3];
    idx.sort_by(|&a, &b| pts[a].x.partial_cmp(&pts[b].x).unwrap());

    let left = [idx[0], idx[1]];
    let mut left_sorted = left;
    left_sorted.sort_by(|&a, &b| pts[a].y.partial_cmp(&pts[b].y).unwrap());
    let tl = left_sorted[0];
    let bl = left_sorted[1];

    let right = [idx[2], idx[3]];
    let mut right_sorted = right;
    right_sorted.sort_by(|&a, &b| pts[a].y.partial_cmp(&pts[b].y).unwrap());
    let tr = right_sorted[0];
    let br = right_sorted[1];

    [pts[tl], pts[tr], pts[br], pts[bl]]
}
