# Audio Separation

## Backend comparison

| Backend | Device | Audio | RTF |
|---------|--------|-------|:---:|
| Burn wgpu | wgpu (RADV) | short (10s) | 1.465 |
| Burn wgpu | wgpu (RADV) | medium (60s) | 0.794 |
| Burn wgpu | wgpu (RADV) | long (120s) | 0.786 |
| ONNX (onnxruntime-node) | CPU | any (4-stems) | ~6.2 |
| ONNX (onnxruntime-node) | CPU | any (vocals-only) | ~2.2 |

## Burn wgpu

`packages/separate/demucs_burn/` — Thin Rust binary wrapping demucs-core with Burn backend.

### Build

```bash
cargo build --release --bin demucs-burn-wgpu
cargo build --release --bin demucs-burn-cpu --no-default-features --features cpu
```

Binaries: `target/release/demucs-burn-wgpu` (37MB) / `demucs-burn-cpu` (7MB).

### Runtime

- warmup: ~50s on first run (CubeCL shader compilation via RADV), cached by driver thereafter
- model load: ~0.4s

### Known issues

- **CubeCL autotune** (已禁用): causes `elemwise_fuse` pipeline failure → GPU driver hang on RADV. Fix: remove `AutotuneConfig`, disable `burn/fusion`. Note: autotune was the root cause — `tasks_max` default (128) is stable without it.
- **wgpu ≠ Vulkan**: wgpu is cross-platform; on Linux this uses Vulkan via RADV.
- **GPU memory**: 780M iGPU has 5.86 GiB device-local + 11.73 GiB host-visible. 120s stable, longer may timeout.

### tasks_max tuning

`--tasks-max` controls CPU threads for wgpu command recording. Benchmark results (short/10s, AMD 780M RADV):

| tasks_max | Time (10s) | vs 1 |
|:---------:|:----------:|:----:|
|    1      |   14.83s   |  —   |
|    2      |   13.54s   | -8.7% |
|    4      |   12.87s   | -13.2% |
|    8      |   12.82s   | -13.6% |
|   16      |   12.50s   | -15.7% |
|   32      |   12.82s   | -13.6% |
|   64      |   13.06s   | -11.9% |
|  128      |   12.45s   | -16.1% |

Default 128 gives best perf. All values stable without CubeCL autotune.

## ONNX (onnxruntime-node)

`packages/cli/src/ml/demucs.ts` — Node.js wrapper using onnxruntime-node. Slow due to CPU-only ORT inference. Used as fallback when Burn wgpu is unavailable.
