# Audio Separation

## Backend comparison

All benchmarks on `htdemucs_ft`, `tasks_max=1`. CPU: Ryzen 7 7840HS. GPU: Radeon 780M (RADV). RTF computed from generation time only (excluding load & warmup).

| Backend | Device | Audio | RTF (gen only) |
|---------|--------|-------|:--------------:|
| Burn wgpu | wgpu (RADV) | short (10s) | **2.77** |
| Burn wgpu | wgpu (RADV) | medium (60s) | **2.41** |
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

| Binary | Size | RTF (medium, 60s) | RTF +fusion | Notes |
|--------|:----:|:------------------:|:-----------:|-------|
| `demucs-burn-wgpu` | 37MB | **2.41** | **2.40** | GPU via Vulkan, +16s warmup first run |
| `demucs-burn-tch` | 4.0MB | **1.26** | — | CPU via MKL, no warmup overhead, needs `LD_LIBRARY_PATH` |
| `demucs-burn-cpu` | 177MB | — | — | CubeCL MLIR, per-kernel JIT too slow for demucs |
| `demucs-burn-rocm` | 32MB | — | — | `GPU Hang` on 780M MES, needs gfx9+ ROCm |

### Runtime

- model load: ~1.0s (tch), ~1.2s~1.5s (wgpu)
- warmup (`--warmup`): ~16s wgpu, pre-compiles CubeCL shaders for all 4 htdemucs_ft models. Reduces first-inference RTF by ~15%.
  Without warmup, shader compilation happens lazily during inference, increasing first-run RTF (short 3.44, medium 2.68).
  With warmup, inference-only RTF is 2.83 (short) / 2.41 (medium).
- GPU fusion (`--features cubecl-wgpu,fusion`): 实测无改善（RTF 2.40 vs 2.41，在误差范围内）。fusion 对 demucs 的小 kernel 卷积和 transposed conv 无效。已确认在 RADV 780M 上不 crash。
- CUDA GPU: tch can use CUDA if available (not tested here)
- Real CPU production path: **tch** (RTF 1.26-1.66) or **ggml** (RTF 1.44-2.91)
- Default model: `htdemucs_ft` (4 per-stem specialist models, 333MB). Change with `--model htdemucs`.

### Known issues

- **CubeCL autotune** (wgpu 已禁用): causes `elemwise_fuse` pipeline failure → GPU driver hang on RADV. Fix: remove `AutotuneConfig`.
- **Burn fusion** (`--features cubecl-wgpu,fusion`): 在 RADV+780M 上不 crash，但对 demucs 无性能提升（RTF 2.41→2.40，误差范围）。fusion 主要优化 elementwise 操作链（add+norm+act等），而 demucs 瓶颈在 conv/conv_transpose，fusion 无法覆盖。
- **wgpu ≠ Vulkan**: wgpu is cross-platform; on Linux this uses Vulkan via RADV.
- **GPU memory on 780M**: 5.86 GiB device-local + 11.73 GiB host-visible. 120s wgpu stable.
- **tch libtorch**: needs `LD_LIBRARY_PATH` pointing to libtorch lib dir at runtime.
- **cubecl-cpu**: impractical for demucs — MLIR JIT compiles each kernel individually, conv/matmul unoptimized per Burn 0.20 notes.
- **cubecl-rocm**: `GPU Hang` on 780M (MES firmware issue), requires gfx9+ with stable ROCm.

### tasks_max tuning (wgpu only)

`--tasks-max` controls CPU threads for wgpu command recording. Default 128.

## ONNX (onnxruntime-node)

`packages/cli/src/ml/demucs.ts` — Node.js wrapper using onnxruntime-node. Slow due to CPU-only ORT inference. Used as fallback when Burn wgpu is unavailable.
