# Audio Separation

## Backend comparison

All benchmarks on `htdemucs_ft`, `tasks_max=1`. CPU: Ryzen 7 7840HS. GPU: Radeon 780M (RADV). RTF computed from generation time only (excluding load & warmup).

| Backend | Device | Audio | RTF (gen only) |
|---------|--------|-------|:--------------:|
| Burn wgpu | wgpu (RADV) | short (10s) | **2.77** |
| Burn wgpu | wgpu (RADV) | medium (60s) | **2.37** |
| Burn tch | libtorch CPU | short (10s) | **1.66** |
| Burn tch | libtorch CPU | medium (60s) | **1.26** |
| ONNX (onnxruntime-node) | Node CPU | any (4-stems) | ~6.2 | — |
| ONNX (onnxruntime-node) | Node CPU | any (vocals) | ~2.2 | — |

## Burn wgpu

`packages/separate/demucs_burn/` — Thin Rust binary wrapping demucs-core with Burn backend.

### Build

```bash
# cubecl-wgpu (GPU via Vulkan/Metal/DX12, default) — works
cargo build --release --bin demucs-burn-wgpu

# cubecl-cpu (CubeCL CPU via MLIR — experimental, very slow for demucs)
cargo build --release --bin demucs-burn-cpu --no-default-features --features cubecl-cpu

# cubecl-rocm (AMD ROCm HIP — MES hang on 780M, requires gfx9+ with stable ROCm)
cargo build --release --bin demucs-burn-rocm --no-default-features --features cubecl-rocm

# tch (libtorch CPU via MKL — best CPU path, requires LD_LIBRARY_PATH)
LIBTORCH_DIR=$(find target/release/build/torch-sys-*/out/libtorch/libtorch/lib -maxdepth 0)
LIBTORCH_DIR=$LIBTORCH_DIR cargo build --release --bin demucs-burn-tch --no-default-features --features tch
```

| Binary | Size | RTF (short infer) | Notes |
|--------|:----:|:-----------------:|-------|
| `demucs-burn-wgpu` | 37MB | 2.83 | GPU via Vulkan, +16s warmup first run |
| `demucs-burn-tch` | 4.0MB | **1.66** | CPU via MKL, no warmup overhead, needs `LD_LIBRARY_PATH` |
| `demucs-burn-cpu` | 177MB | — | CubeCL MLIR, per-kernel JIT too slow for demucs |
| `demucs-burn-rocm` | 32MB | — | `GPU Hang` on 780M MES, needs gfx9+ ROCm |

### Runtime

- model load: ~1.0s (tch), ~1.2s (wgpu)
- warmup (`--warmup`): ~16s wgpu, pre-compiles CubeCL shaders for all 4 htdemucs_ft models. Reduces first-inference RTF by ~15%.
  Without warmup, shader compilation happens lazily during inference, increasing first-run RTF (short 3.44, medium 2.68).
  With warmup, inference-only RTF is 2.83 (short) / 2.34 (medium).
- CUDA GPU: tch can use CUDA if available (not tested here)
- Real CPU production path: **tch** (RTF 1.26-1.66) or **ggml** (RTF 1.44-2.91)
- Default model: `htdemucs_ft` (4 per-stem specialist models, 333MB). Change with `--model htdemucs`.

### Known issues

- **CubeCL autotune** (wgpu 已禁用): causes `elemwise_fuse` pipeline failure → GPU driver hang on RADV. Fix: remove `AutotuneConfig`. We keep `fusion = ["burn/fusion"]` available but not in default features.
- **wgpu ≠ Vulkan**: wgpu is cross-platform; on Linux this uses Vulkan via RADV.
- **GPU memory on 780M**: 5.86 GiB device-local + 11.73 GiB host-visible. 120s wgpu stable.
- **tch libtorch**: needs `LD_LIBRARY_PATH` pointing to libtorch lib dir at runtime.
- **cubecl-cpu**: impractical for demucs — MLIR JIT compiles each kernel individually, conv/matmul unoptimized per Burn 0.20 notes.
- **cubecl-rocm**: `GPU Hang` on 780M (MES firmware issue), requires gfx9+ with stable ROCm.

### tasks_max tuning (wgpu only)

`--tasks-max` controls CPU threads for wgpu command recording. Default 1 for stability with `htdemucs_ft`:

| tasks_max | short (10s) | vs 1 |
|:---------:|:-----------:|:----:|
|    1      |   34.4s     |  —   |
|   128     |   crash     |  —   |

Higher values may work with the single-model `htdemucs` but are unstable with `htdemucs_ft` on 780M.

## ONNX (onnxruntime-node)

`packages/cli/src/ml/demucs.ts` — Node.js wrapper using onnxruntime-node. Slow due to CPU-only ORT inference. Used as fallback when Burn wgpu is unavailable.
