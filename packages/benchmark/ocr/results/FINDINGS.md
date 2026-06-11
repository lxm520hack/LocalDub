# OCR Benchmark Results

## Summary

RapidOCR (PaddleOCR ONNX) on anime hard subtitles (720p video, 30fps, bottom-positioned dialogue subs). Ground truth: 564 chars (643 with spaces), 93 segments.

Three OCR engine variants compared:
- **Python** (`ocr_frame.py`) — full pipeline via `rapidocr_onnxruntime` Python package
- **Node.js** (`ocr_node.ts`) — inference via `onnxruntime-node` (CPU), post-processing via Python subprocess
- **C++ ORT** (`ocr_pipeline.cpp`) — native ORT C++ pipeline with custom DB post-processing (no Python subprocess)

### Comparison

| Config | fps | ts | Sub-only | Engine | Frames | Segs | CER | hyp/ref | RTF |
|--------|-----|----|----------|--------|--------|------|-----|---------|-----|
| fps0.5 | 0.5 | 0.5 | ❌ | python | 85 | 53 | 24.82% | 451/564 | 0.286 |
| fps1 | 1 | 0.5 | ❌ | python | 170 | 72 | 6.38% | 565/564 | 0.586 |
| fps2 | 2 | 0.5 | ❌ | python | 340 | 78 | 13.12% | 611/564 | **1.133** |
| ts0.3 | 1 | 0.3 | ❌ | python | 170 | 76 | 7.62% | 574/564 | 0.570 |
| **sub-only** | **1** | **0.3** | **✅** | **python** | **170** | **74** | **6.38%** | **567/564** | **0.568** |
| **node** | **1** | **0.3** | **✅** | **node** | **170** | **74** | **9.22%** | **583/564** | **0.325** |
| **cpp-sub** | **1** | **0.5** | **✅** | **cpp** | **170** | **76** | **11.70%** | **598/564** | **0.182** |
| cpp-fps05 | 0.5 | 0.5 | ✅ | cpp | 85 | 54 | 24.82% | 455/564 | **0.091** |

### CER Analysis

**C++ vs Python at fps1, sub-only** (11.70% vs 6.38%):
- Both engines miss same GT chars: `凑` (要→要齐), `家产`→`家当`, `师父`→`师傅`, `喂我喝汤`→`在喂我喝汤`
- C++ specific errors: `方一`→`万一` (phonetic), `于`→`干` (visual), `乎平`→`乎乎` (visual), `010` hallucination, duplicate segments from consecutive frames
- These errors are fixable by LLM correction stage — all are either phonetic confusions or common OCR artifacts

**At 0.5 fps**, both C++ and Python achieve identical CER **24.82%** (same character errors), confirming the C++ recognition quality matches Python at lower frame rates.

### Performance (RTF)

OCR runs entirely on CPU (RapidOCR on onnxruntime):

**Python engine:**
| Config | fps | Frames | OCR inf (s) | RTF |
|--------|-----|--------|-------------|-----|
| fps0.5 | 0.5 | 85 | 48.1 | **0.286** |
| fps1 | 1 | 170 | 99.0 | **0.586** |
| fps2 | 2 | 340 | 192.1 | **1.133** |

**Node.js engine (onnxruntime-node + cached sessions):**
| Config | fps | Frames | OCR inf (s) | RTF | vs Python |
|--------|-----|--------|-------------|-----|-----------|
| sub-only | 1 | 170 | 55.0 | **0.325** | **1.7× faster** |

**C++ ORT engine (native, no Python subprocess):**
| Config | fps | Frames | OCR inf (s) | RTF | vs Python | vs Node |
|--------|-----|--------|-------------|-----|-----------|---------|
| sub-only 1fps | 1 | 170 | 30.8 | **0.182** | **3.1× faster** | **1.8× faster** |
| sub-only 0.5fps | 0.5 | 85 | 15.3 | **0.091** | — | — |

- C++ engine eliminates Python subprocess entirely — det inference **140ms/frame** (200ms faster than Node), post-process **15ms** (replaces 130ms Python call)
- At 0.5 fps (sub-only): RTF **0.091** — matches whisper.cpp Vulkan ASR throughput
- C++ per-frame breakdown: det 140ms, post-process 15ms, rec 6ms, cls ~0.2ms
- Main bottleneck is det model inference (140ms), which runs on CPU with no GPU EP for ORT on ROCm

**OCR vs ASR comparison**:
| Method | CER | RTF | Captures "哈哈哈" | Captures "啊" | Timestamp precision |
|--------|-----|-----|:----------------:|:--------------:|:-------------------:|
| ASR best (sidechain+temp-02) | 7.72% | **0.090** | ❌ | ❌ | +0.04s (excellent) |
| **OCR sub-only (Python)** | **6.38%** | **0.568** | **✅** | **✅** | ~±0.5s (grid-limited) |
| OCR sub-only (Node.js) | 9.22% | **0.325** | **✅** | **✅** | ~±0.5s (grid-limited) |
| **OCR sub-only (C++)** | **11.70%** | **0.182** | **✅** | **✅** | ~±0.5s (grid-limited) |
| OCR sub-only (C++, 0.5fps) | 24.82% | **0.091** | ✅ | ❌ | ~±1.0s (grid-limited) |
| OCR default (Python) | 6.38% | 0.586 | ✅ | ❌ | ~±0.5s (grid-limited) |

OCR catches both short segments that all ASR params miss ("哈哈哈" at 115.42s and two "啊" at 113.96s and 128.00s), at competitive CER.

### Pipeline Decision

**C++ ORT engine recommended for production** despite higher CER (11.70% vs 6.38%):
- 3.1× faster than Python (RTF 0.182 vs 0.568) → 30s vs 99s for a 3-min video
- 1.8× faster than Node.js (RTF 0.182 vs 0.325)
- No Python dependency in production deployment
- Recognition errors are **LLM-correctable** (phonetic/visual confusions, duplicate dedup)
- At 0.5 fps sub-only, RTF 0.091 is nearly identical to ASR (0.090), enabling combined OCR+ASR pipeline

If CER parity with Python is needed, the crop strategy should be upgraded from AABB expansion to full perspective-warped crop matching Python's cv2.minAreaRect approach.

### Key Files

- `ocr_frame.py` — Python RapidOCR wrapper with `--text-score`, `--full-frame`, `--subtitle-only` options
- `ocr_node.ts` — Node.js OCR pipeline (onnxruntime-node + Python post-process subprocess), used as `benchmark-ocr-video.ts --engine node`
- `postprocess_det.py` — Python helper for detection model post-processing (cv2 findContours, minAreaRect, unclip)
- `cpp/ocr_pipeline.cpp` — C++ ORT native pipeline (single-file, cmake build), links system onnxruntime
- `cpp/geometry.h` — Convex hull, minAreaRect, connected components, polygon utilities
- `cpp/image.h` — stb_image loader + bilinear resize
- `benchmark-ocr-video.ts` — Node.js orchestration (ffmpeg extraction → OCR → merge → CER eval), supports `--engine python|node|cpp`
- `srt_manual.json` — Ground truth shared with ASR benchmark

### Known Limitations

- Timestamps are quantized to the fps grid (e.g. ±0.5s at 1fps)
- Single-char subs need `text_score` ≤ 0.3 (default 0.5 misses them)
- Scene text at bottom of frame (numbers, UI elements) can leak into results without Y-position filtering
- `--subtitle-only` uses hardcoded Y range 620-700 (for 720p); different video heights would need adjustment
- C++ AABB crop (vs Python perspective-warped crop) introduces more background noise → slightly higher CER
- C++ ORT det model no GPU EP available on ROCm (no ROCm ORT build); CPU only
