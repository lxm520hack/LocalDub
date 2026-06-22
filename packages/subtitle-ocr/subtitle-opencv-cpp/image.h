#pragma once
#include <cstdint>
#include <vector>
#include <cmath>
#include <algorithm>
#include <stdexcept>
#include <string>

#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

#ifdef _WIN32
#include <windows.h>
#endif

struct Image {
    int w, h, c;
    std::vector<uint8_t> data;
};

static Image loadImage(const char* path) {
    Image img;
    int n = 0;
    unsigned char* pixels = nullptr;

#ifdef _WIN32
    FILE* f = fopen(path, "rb");
    if (!f) {
        DWORD err = GetLastError();
        int wlen = MultiByteToWideChar(CP_ACP, 0, path, -1, nullptr, 0);
        if (wlen > 0) {
            std::wstring wpath(wlen, L'\0');
            MultiByteToWideChar(CP_ACP, 0, path, -1, &wpath[0], wlen);
            f = _wfopen(wpath.c_str(), L"rb");
        }
        if (!f) {
            throw std::runtime_error(std::string("Failed to open file (err=") + std::to_string(err) + "): " + path);
        }
    }
    pixels = stbi_load_from_file(f, &img.w, &img.h, &n, 3);
    fclose(f);
#else
    pixels = stbi_load(path, &img.w, &img.h, &n, 3);
#endif

    if (!pixels) {
        std::string reason = stbi_failure_reason() ? stbi_failure_reason() : "unknown";
        throw std::runtime_error("Failed to load image: " + reason);
    }
    if (img.w <= 0 || img.h <= 0) {
        throw std::runtime_error("Invalid image dimensions: " + std::to_string(img.w) + "x" + std::to_string(img.h));
    }
    img.c = 3;
    img.data.assign(pixels, pixels + img.w * img.h * 3);
    stbi_image_free(pixels);

    // stbi_load returns RGB order, but PaddleOCR/RapidOCR models were trained
    // with cv2.imread (BGR order). Convert RGB -> BGR to match model training.
    for (int i = 0; i < img.w * img.h; ++i) {
        std::swap(img.data[i * 3 + 0], img.data[i * 3 + 2]);
    }
    return img;
}

static float sampleBilinear(const Image& img, float x, float y, int c) {
    // BORDER_REPLICATE: 采样点在图像外时用最近的边缘像素（而非 0）
    // 与 Python cv2.warpPerspective(..., borderMode=BORDER_REPLICATE) 对齐
    if (x < 0) x = 0;
    if (x >= img.w) x = (float)(img.w - 1);
    if (y < 0) y = 0;
    if (y >= img.h) y = (float)(img.h - 1);
    int x0 = std::max(0, std::min((int)x, img.w - 2));
    int y0 = std::max(0, std::min((int)y, img.h - 2));
    int x1 = std::min(x0 + 1, img.w - 1);
    int y1 = std::min(y0 + 1, img.h - 1);
    float fx = x - x0, fy = y - y0;
    auto px = [&](int px, int py) -> float {
        return img.data[(py * img.w + px) * img.c + c];
    };
    return (1-fy)*(1-fx)*px(x0,y0) + (1-fy)*fx*px(x1,y0)
         + fy*(1-fx)*px(x0,y1) + fy*fx*px(x1,y1);
}

// Bicubic interpolation (Catmull-Rom spline, a = -0.5)
// Matches OpenCV INTER_CUBIC behavior for warpPerspective
static float cubicWeight(float t) {
    // Standard bicubic kernel (Keys)
    float tt = t * t;
    float ttt = tt * t;
    // a = -0.5
    if (t < 1.0f)
        return 1.5f * ttt - 2.5f * tt + 1.0f;
    if (t < 2.0f)
        return -0.5f * ttt + 2.5f * tt - 4.0f * t + 2.0f;
    return 0.0f;
}

static float sampleBicubic(const Image& img, float x, float y, int c) {
    // BORDER_REPLICATE: replicate edge pixels
    int xi = (int)x;
    int yi = (int)y;
    float dx = x - xi;
    float dy = y - yi;

    float sum = 0.0f;
    float wsum = 0.0f;

    for (int j = -1; j <= 2; ++j) {
        float wy = cubicWeight(std::fabs((float)j - dy));
        if (wy == 0.0f) continue;
        int sy = yi + j;
        if (sy < 0) sy = 0;
        if (sy >= img.h) sy = img.h - 1;

        for (int i = -1; i <= 2; ++i) {
            float wx = cubicWeight(std::fabs((float)i - dx));
            if (wx == 0.0f) continue;
            int sx = xi + i;
            if (sx < 0) sx = 0;
            if (sx >= img.w) sx = img.w - 1;

            float pixel = img.data[(sy * img.w + sx) * img.c + c];
            sum += wy * wx * pixel;
            wsum += wy * wx;
        }
    }

    if (wsum == 0.0f) return 0.0f;
    float val = sum / wsum;
    if (val < 0.0f) val = 0.0f;
    if (val > 255.0f) val = 255.0f;
    return val;
}

static void resizeBilinear(const uint8_t* src, int sw, int sh, uint8_t* dst, int dw, int dh) {
    for (int dy = 0; dy < dh; ++dy) {
        float sy = (dy + 0.5f) * sh / dh - 0.5f;
        sy = std::max(0.0f, std::min<float>(sh - 1, sy));
        int sy0 = (int)sy, sy1 = std::min(sy0 + 1, sh - 1);
        float fy = sy - sy0;
        for (int dx = 0; dx < dw; ++dx) {
            float sx = (dx + 0.5f) * sw / dw - 0.5f;
            sx = std::max(0.0f, std::min<float>(sw - 1, sx));
            int sx0 = (int)sx, sx1 = std::min(sx0 + 1, sw - 1);
            float fx = sx - sx0;
            for (int c = 0; c < 3; ++c) {
                float v = (1-fy)*(1-fx)*src[(sy0*sw+sx0)*3+c]
                        + (1-fy)*fx   *src[(sy0*sw+sx1)*3+c]
                        + fy   *(1-fx)*src[(sy1*sw+sx0)*3+c]
                        + fy   *fx   *src[(sy1*sw+sx1)*3+c];
                dst[(dy*dw+dx)*3+c] = (uint8_t)std::round(v);
            }
        }
    }
}
