//! Image utilities (replacement for C++ image.h).
//!
//! Loads PNG/JPEG via the `image` crate into an in-memory RGB buffer, and
//! provides geometric helpers used by the OCR pipeline: bilinear resize, 180°
//! rotation, and perspective-warp crop (for pulling text regions out of the
//! original frame).
//!
//! Performance: the resize and warp functions use pre-computed interpolation
//! coefficients to minimize per-pixel floating-point work.

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

/// Resize src (src_w x src_h) into dst (dst_w x dst_h) using bilinear
/// interpolation. Pre-computes column interpolation coefficients so that the
/// hot inner loop only does weighted averaging.
pub fn resize_bilinear(
    src: &[u8], src_w: usize, src_h: usize,
    dst: &mut [u8], dst_w: usize, dst_h: usize,
) {
    // Pre-compute column coefficients: for each dst col x, compute (x0, x1, fx, 1-fx).
    // x0 = floor((x + 0.5) * scale - 0.5), clamped.
    let scale_x = src_w as f32 / dst_w as f32;
    let scale_y = src_h as f32 / dst_h as f32;

    // Column interpolation: 4 coefficients per dst column (x0_idx, x1_idx, w0, w1).
    // We store as (x0i, x1i, w0, w1) for integer indices + float weights.
    let mut col_x = vec![0i32; dst_w];
    let mut col_w = vec![(0.0f32, 0.0f32); dst_w];
    for x in 0..dst_w {
        let src_x = (x as f32 + 0.5) * scale_x - 0.5;
        let x0 = src_x.floor();
        let fx = src_x - x0;
        let x0i = x0 as i32;
        let x1i = x0i + 1;
        col_x[x] = x0i;
        col_w[x] = (1.0 - fx, fx);
    }

    // Row interpolation: same idea.
    let mut row_y = vec![0i32; dst_h];
    let mut row_w = vec![(0.0f32, 0.0f32); dst_h];
    for y in 0..dst_h {
        let src_y = (y as f32 + 0.5) * scale_y - 0.5;
        let y0 = src_y.floor();
        let fy = src_y - y0;
        let y0i = y0 as i32;
        let y1i = y0i + 1;
        row_y[y] = y0i;
        row_w[y] = (1.0 - fy, fy);
    }

    let src_w_i = src_w as i32;
    let src_h_i = src_h as i32;

    // Now do the actual resampling. For each output pixel (x, y):
    //   val = sum over i=0..1, j=0..1 of src[(y0+i, x0+j)] * wy[i] * wx[j]
    // We iterate channels separately to keep the inner loop simple.
    for y in 0..dst_h {
        let y0 = row_y[y];
        let y1 = y0 + 1;
        let y0_clamped = y0.clamp(0, src_h_i - 1) as usize;
        let y1_clamped = y1.clamp(0, src_h_i - 1) as usize;
        let (wy0, wy1) = row_w[y];
        let row0_start = y0_clamped * src_w * 3;
        let row1_start = y1_clamped * src_w * 3;

        for x in 0..dst_w {
            let x0 = col_x[x];
            let x1 = x0 + 1;
            let x0_clamped = x0.clamp(0, src_w_i - 1) as usize;
            let x1_clamped = x1.clamp(0, src_w_i - 1) as usize;
            let (wx0, wx1) = col_w[x];

            let idx00 = row0_start + x0_clamped * 3;
            let idx10 = row0_start + x1_clamped * 3;
            let idx01 = row1_start + x0_clamped * 3;
            let idx11 = row1_start + x1_clamped * 3;

            let di = (y * dst_w + x) * 3;
            for ch in 0..3 {
                let v00 = src[idx00 + ch] as f32;
                let v10 = src[idx10 + ch] as f32;
                let v01 = src[idx01 + ch] as f32;
                let v11 = src[idx11 + ch] as f32;
                let v0 = v00 * wx0 + v10 * wx1;
                let v1 = v01 * wx0 + v11 * wx1;
                let v = v0 * wy0 + v1 * wy1;
                dst[di + ch] = v.clamp(0.0, 255.0) as u8;
            }
        }
    }
}

pub fn rotate_180(img: &Image) -> Image {
    let mut out = Image::new(img.w, img.h);
    let half = img.h / 2;
    for y in 0..half {
        let y2 = img.h - 1 - y;
        let row_bytes = img.w * 3;
        let s1 = y * row_bytes;
        let s2 = y2 * row_bytes;
        for x in 0..row_bytes {
            out.data[s1 + x] = img.data[s2 + (row_bytes - 1 - x)];
            out.data[s2 + x] = img.data[s1 + (row_bytes - 1 - x)];
        }
    }
    if img.h % 2 == 1 {
        let y = half;
        let row_bytes = img.w * 3;
        let s = y * row_bytes;
        for x in 0..row_bytes {
            out.data[s + x] = img.data[s + (row_bytes - 1 - x)];
        }
    }
    out
}

/// 2D point with float coordinates (subpixel).
#[derive(Copy, Clone, Debug)]
pub struct Point { pub x: f32, pub y: f32 }

/// Perspective-warp crop: maps source 4-point polygon to a rectangle of size
/// (out_w, out_h), pulling pixels from `img` via bilinear sampling. Uses
/// pre-computed row coefficients to minimize per-pixel floating-point work.
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

    // Solve 8x8 perspective transform: dst corners (u, v) -> source corners.
    let (u0, v0) = (0.0_f64, 0.0_f64);
    let (u1, v1) = ((dst_w - 1) as f64, 0.0_f64);
    let (u2, v2) = ((dst_w - 1) as f64, (dst_h - 1) as f64);
    let (u3, v3) = (0.0_f64, (dst_h - 1) as f64);
    let (x0, y0) = (pts[0].x as f64, pts[0].y as f64);
    let (x1, y1) = (pts[1].x as f64, pts[1].y as f64);
    let (x2, y2) = (pts[2].x as f64, pts[2].y as f64);
    let (x3, y3) = (pts[3].x as f64, pts[3].y as f64);

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

    for i in 0..8 {
        let mut max_row = i;
        let mut max_val = m[i][i].abs();
        for k in (i + 1)..8 {
            let v = m[k][i].abs();
            if v > max_val { max_val = v; max_row = k; }
        }
        if max_row != i { m.swap(i, max_row); }
        let pivot = m[i][i];
        if pivot.abs() < 1e-10 {
            // Fallback: axis-aligned crop.
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
                let si = ((y + ymin) * img.w + xmin) * 3;
                let di = y * w * 3;
                for x in 0..w * 3 {
                    out.data[di + x] = img.data[si + x];
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
    let a = m[0][8] as f32;
    let b = m[1][8] as f32;
    let c = m[2][8] as f32;
    let d = m[3][8] as f32;
    let e = m[4][8] as f32;
    let f = m[5][8] as f32;
    let g = m[6][8] as f32;
    let h = m[7][8] as f32;

    let mut result = Image::new(out_w, out_h);
    let out_data = &mut result.data;
    let src_data = &img.data;
    let iw = img.w as i32;
    let ih = img.h as i32;

    for dy in 0..out_h {
        // (u, v) = output pixel coords before rotate90 mapping.
        // In non-rotate mode: out pixel (dx, dy) maps to (dx, dy).
        // In rotate90 mode: out pixel (dx, dy) maps to (dst_w - 1 - dy, dx).
        let v_base = dy as f32;
        for dx in 0..out_w {
            let u = if rotate90 { (dst_w - 1 - dy) as f32 } else { dx as f32 };
            let v = if rotate90 { dx as f32 } else { v_base };

            let denom = g * u + h * v + 1.0;
            let inv_denom = 1.0 / denom;
            let sx = (a * u + b * v + c) * inv_denom;
            let sy = (d * u + e * v + f) * inv_denom;

            // Bilinear sample at (sx, sy).
            let x0 = sx.floor();
            let y0 = sy.floor();
            let fx = sx - x0;
            let fy = sy - y0;
            let x0i = x0 as i32;
            let y0i = y0 as i32;

            let xi0 = x0i.max(0) as usize;
            let xi1 = (x0i + 1).min(iw - 1).max(0) as usize;
            let yi0 = y0i.max(0) as usize;
            let yi1 = (y0i + 1).min(ih - 1).max(0) as usize;

            let idx00 = (yi0 * img.w + xi0) * 3;
            let idx10 = (yi0 * img.w + xi1) * 3;
            let idx01 = (yi1 * img.w + xi0) * 3;
            let idx11 = (yi1 * img.w + xi1) * 3;

            let di = (dy * out_w + dx) * 3;
            let wx1 = fx;
            let wx0 = 1.0 - fx;
            let wy1 = fy;
            let wy0 = 1.0 - fy;

            for ch in 0..3 {
                let v00 = src_data[idx00 + ch] as f32;
                let v10 = src_data[idx10 + ch] as f32;
                let v01 = src_data[idx01 + ch] as f32;
                let v11 = src_data[idx11 + ch] as f32;
                let v0 = v00 * wx0 + v10 * wx1;
                let v1 = v01 * wx0 + v11 * wx1;
                let v = v0 * wy0 + v1 * wy1;
                out_data[di + ch] = v.clamp(0.0, 255.0) as u8;
            }
        }
    }
    result
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
