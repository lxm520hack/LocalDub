# GPU Status & CUDA EP Strategy

## Hardware

- **GPU**: AMD Radeon 780M (gfx1103, RDNA 3)
- **ROCm**: 7.2.3
- **PyTorch**: ROCm build (2.5+)
- **ONNX Runtime**: 1.26.0 (node) / 1.18.0 (python CV3)

## Per-Model GPU Status

| Model | Runtime | Attempted EP | Result |
|-------|---------|-------------|--------|
| Demucs | PyTorch | cuda | ❌ GPU hang (CrossTransformer + Wiener filter) |
| VoxCPM | PyTorch | cuda | ❌ Loads OK, forward pass → segfault |
| Whisper | PyTorch | cuda | ✅ Works fine |
| VoxCPM | ONNX | webgpu | ⚠️ Short OK, medium+ OOM |
| VoxCPM | ONNX | cuda | ❌ Missing cuDNN 9 |
| CosyVoice3 | ONNX | cuda | ❌ Missing cuDNN 9 |

## Root Cause: Missing cuDNN 9

ONNX Runtime's CUDA EP requires cuDNN ≥ 9.x. The system has ROCm installed but not cuDNN.

```
Error: Failed to create CUDA execution provider:
  Cannot open library libcudnn_ops.so.9
  (libcudnn_ops.so.9: cannot open shared object file: No such file or directory)
```

## Installing cuDNN 9

### For ROCm + AMD GPU

cuDNN is NVIDIA's library — it does **NOT** work on AMD GPUs. ONNX Runtime's CUDA EP requires an **NVIDIA GPU** with CUDA + cuDNN.

**On AMD RDNA 3 with ROCm, CUDA EP cannot work.**

### What CAN work on AMD

| EP | Availability | Notes |
|----|-------------|-------|
| CPU | ✅ Default | Works, slow |
| WebGPU | ✅ orttx/Node.js only | OOM issues |
| ROCm | ❌ Not in prebuilt ORT | Must compile ORT from source with ROCm support |
| OpenVINO | ❌ Intel only | N/A for AMD GPU |

### ROCm ORT Build (Alternative)

To get GPU acceleration for ORT on AMD, must compile ONNX Runtime from source with ROCm:

```bash
git clone --recursive https://github.com/microsoft/onnxruntime.git
cd onnxruntime
./build.sh --config Release \
  --use_rocm \
  --rocm_home /opt/rocm \
  --build_shared_lib \
  --parallel
```

This takes ~2-3 hours and requires full ROCm dev toolchain.

## Recommended Action

Given cuDNN CUDA EP is impossible on AMD hardware, the realistic options ranked by impact:

1. **Fix WebGPU OOM** (release ONNX sessions between generations) — immediate benefit for TS ONNX VoxCPM
2. **Compile ORT with ROCm** (1-time effort, ~3h build) — enables GPU for all ONNX models
3. **Install NVIDIA GPU** (hardware purchase) — unlocks CUDA EP + cuDNN + TensorRT
4. **Reduce DiT autoPatches** (software tweak) — less wasted generation
