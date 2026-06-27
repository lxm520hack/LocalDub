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

- **CubeCL autotune**: causes `elemwise_fuse` pipeline failure → GPU driver hang on RADV (`context lost / guilty of hard recovery`). Fix: remove `AutotuneConfig`, set `tasks_max: 1`, disable `burn/fusion`.
- **wgpu ≠ Vulkan**: wgpu is cross-platform; on Linux this uses Vulkan via RADV.
- **GPU memory**: 780M iGPU has 5.86 GiB device-local + 11.73 GiB host-visible. 120s stable, longer may timeout.

## ONNX (onnxruntime-node)

`packages/cli/src/ml/demucs.ts` — Node.js wrapper using onnxruntime-node. Slow due to CPU-only ORT inference. Used as fallback when Burn wgpu is unavailable.
