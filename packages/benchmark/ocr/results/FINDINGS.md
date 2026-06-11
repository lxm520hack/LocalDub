# OCR Benchmark Results

## Summary

RapidOCR (PaddleOCR ONNX) on anime hard subtitles (720p video, 30fps, bottom-positioned dialogue subs). Ground truth: 564 chars (643 with spaces), 93 segments.

Two OCR engine variants compared:
- **Python** (`ocr_frame.py`) — full pipeline via `rapidocr_onnxruntime` Python package
- **Node.js** (`ocr_node.ts`) — inference via `onnxruntime-node` (CPU), post-processing via Python subprocess

### Comparison

| Config | fps | ts | Sub-only | Engine | Frames | Segs | CER | hyp/ref | RTF |
|--------|-----|----|----------|--------|--------|------|-----|---------|-----|
| fps0.5 | 0.5 | 0.5 | ❌ | python | 85 | 53 | 24.82% | 451/564 | 0.286 |
| fps1 | 1 | 0.5 | ❌ | python | 170 | 72 | 6.38% | 565/564 | 0.586 |
| fps2 | 2 | 0.5 | ❌ | python | 340 | 78 | 13.12% | 611/564 | **1.133** |
| ts0.3 | 1 | 0.3 | ❌ | python | 170 | 76 | 7.62% | 574/564 | 0.570 |
| **sub-only** | **1** | **0.3** | **✅** | **python** | **170** | **74** | **6.38%** | **567/564** | **0.568** |
| **node** | **1** | **0.3** | **✅** | **node** | **170** | **74** | **9.22%** | **583/564** | **0.325** |

### Key Findings

**Single-char subtitle detection**:
- Single characters like "啊" (Y=645-685, same zone as multi-char subs) have lower recognition confidence (~0.46) vs multi-char subs (e.g. "谢师傅指点" → 0.82)
- Default `text_score=0.5` filters single-char detections out
- Lowering to `text_score=0.3` catches "啊" but also lets through background scene text ("90" at 13s, "11000" at 70s)
- **`--subtitle-only` mode** (post-filter by Y=620-700) eliminates scene text while keeping low-confidence single-char subs
- Best result: `text_score=0.3` + Y position filter → CER **6.38%** (same as default), catches both "啊" occurrences (114s, 128s)

### Performance (RTF)

OCR runs entirely on CPU (RapidOCR on onnxruntime). RTF scales linearly with fps:

**Python engine:**
| Config | fps | Frames | OCR inf (s) | RTF |
|--------|-----|--------|-------------|-----|
| fps0.5 | 0.5 | 85 | 48.1 | **0.286** |
| fps1 | 1 | 170 | 99.0 | **0.586** |
| fps2 | 2 | 340 | 192.1 | **1.133** |

**Node.js engine (onnxruntime-node + cached sessions):**

| Config | fps | Frames | OCR inf (s) | RTF | vs Python |
|--------|-----|--------|-------------|-----|-----------|
| sub-only | 1 | 170 | **55.0** | **0.325** | **1.7× faster** |

- Node.js engine avoids Python overhead (cv2 image loading, object allocations) → 1.7× RTF improvement
- Main bottleneck remains the Python subprocess for DB post-processing (~130ms/frame)
- Full port of post-processing to TypeScript would further reduce RTF to ~0.15-0.20
- whisper.cpp ASR on Vulkan has RTF **0.09** — ~3-6× faster than OCR

**OCR vs ASR comparison**:
| Method | CER | RTF | Captures "哈哈哈" | Captures "啊" | Timestamp precision |
|--------|-----|-----|:----------------:|:--------------:|:-------------------:|
| ASR best (sidechain+temp-02) | 7.72% | **0.090** | ❌ | ❌ | +0.04s (excellent) |
| **OCR sub-only (Python)** | **6.38%** | **0.568** | **✅** | **✅** | ~±0.5s (grid-limited) |
| OCR sub-only (Node.js) | 9.22% | **0.325** | **✅** | **✅** | ~±0.5s (grid-limited) |
| OCR default (Python) | 6.38% | 0.586 | ✅ | ❌ | ~±0.5s (grid-limited) |

OCR catches both short segments that all ASR params miss ("哈哈哈" at 115.42s and two "啊" at 113.96s and 128.00s), at the same CER as default and **lower than the best ASR config**.

The Node.js engine is **1.7× faster** (RTF 0.325 vs 0.568) but has slightly higher CER (9.22% vs 6.38%) due to axis-aligned crop extraction vs Python's perspective-warped crop. This gap is acceptable if LLM correction follows.

### Key Files

- `ocr_frame.py` — Python RapidOCR wrapper with `--text-score`, `--full-frame`, `--subtitle-only` options
- `ocr_node.ts` — Node.js OCR pipeline (onnxruntime-node + Python post-process subprocess), used as `benchmark-ocr-video.ts --engine node`
- `postprocess_det.py` — Python helper for detection model post-processing (cv2 findContours, minAreaRect, unclip)
- `benchmark-ocr-video.ts` — Node.js orchestration (ffmpeg extraction → OCR → merge → CER eval), supports `--engine python|node`
- `srt_manual.json` — Ground truth shared with ASR benchmark

### Known Limitations

- Timestamps are quantized to the fps grid (e.g. ±0.5s at 1fps)
- Single-char subs need `text_score` ≤ 0.3 (default 0.5 misses them)
- Scene text at bottom of frame (numbers, UI elements) can leak into results without Y-position filtering
- `--subtitle-only` uses hardcoded Y range 620-700 (for 720p); different video heights would need adjustment
