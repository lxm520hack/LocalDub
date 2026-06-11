#pragma once
#include <cstdint>
#include <vector>
#include <cmath>

#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

struct Image {
    int w, h, c;
    std::vector<uint8_t> data;
};

static Image loadImage(const char* path) {
    Image img;
    int n;
    unsigned char* pixels = stbi_load(path, &img.w, &img.h, &n, 3);
    if (!pixels) throw std::runtime_error("Failed to load image");
    img.c = 3;
    img.data.assign(pixels, pixels + img.w * img.h * 3);
    stbi_image_free(pixels);
    return img;
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
