# oar-rs — oar-ocr Rust benchmark binary

Wraps [`oar-ocr`](https://crates.io/crates/oar-ocr) v0.7.1 for OCR benchmarking against existing Python/C++/Rust pipelines.

## Usage

```bash
# Local model files (in data/models/rapidocr/)
oar_ocr <image> [text_score]
oar_ocr --dir <directory> [text_score] [--subtitle-only] [--model-size tiny|small|medium]

# Auto-download models to data/models/rapidocr/
oar_ocr --dir <directory> --model-size medium --auto-download
```

### Arguments

| Arg | Default | Description |
|-----|---------|-------------|
| `image` / `--dir <dir>` | — | Input image or directory of frames |
| `text_score` | `0.5` | Recognition confidence threshold |
| `--subtitle-only` | off | Crop bottom 40% of frame |
| `--model-size` | `tiny` | Model variant: `tiny`, `small`, `medium` |
| `--auto-download` | off | Download model files to `data/models/rapidocr/` via oar-ocr registry |
| `OAR_DEBUG=1` | off | Enable oar-ocr/ORT debug tracing |

## Benchmark Results (fps2-so-ts0.45, 341 frames)

| Model | CER | RTF | per-frame | Notes |
|-------|-----|-----|-----------|-------|
| v6 tiny | 6.44% | **0.181** | **90ms** | 7 FP, 0 missed |
| v6 medium | 4.11% | 1.094 | 546ms | 7 FP, 0 missed |
| C++ PP-OCRv3 | **0.36%** | 0.539 | 269ms | 0 FP, 0 missed |

## Known Limitation: `use_dilation`

oar-ocr v0.7.1 hardcodes `use_dilation: false` in `TextDetectionAdapterBuilder` (db_postprocess config). This differs from Python rapidocr and the C++ pipeline, which both use `use_dilation: true` (2×2 dilation kernel).

Without dilation, the thresholded heatmap mask can be thin/fragmented, leading to:
- Higher false positive rate (scene text/UI digits leaking through)
- Missed text regions on weak detections

The underlying `DBModelBuilder` (in `oar_ocr_core`) supports `use_dilation`, but the high-level `OAROCRBuilder` does not expose it. If upstream exposes this config, v3/v4 server models may also become compatible.

**The 4.11% CER of v6 medium vs 0.36% of C++ PP-OCRv3 is not a fair model comparison** due to this post-processing mismatch. Pre-processing (resize, normalization, color order) is identical.

## Model Files

Models map under `data/models/rapidocr/` (set `$OCR_MODELS_DIR` to override):

| Size | Detection | Recognition | Dictionary |
|------|-----------|-------------|------------|
| tiny | pp-ocrv6_tiny_det.onnx (1.8MB) | pp-ocrv6_tiny_rec.onnx (4.5MB) | ppocrv6_tiny_dict.txt (27KB) |
| medium | pp-ocrv6_medium_det.onnx (62MB) | pp-ocrv6_medium_rec.onnx (77MB) | ppocrv6_dict.txt (75KB) |
