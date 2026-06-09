# LocalDub

测试, 实验，探索 一律 不要使用 /tmp , 而是应该 写到当前的仓库中 提供客观测性

## Hardware
AMD Radeon 780M (RDNA 3), ROCm 7.2.4 → `.agents/hardware.md`

## Model device assignment
| 模型 | 设备 | 原因 |
|------|------|------|
| Demucs (PyTorch) | CPU | GPU hang, RTF ~2.0 (htdemucs, shifts=3, 5min 实测) |
| Demucs (ONNX, onnxruntime-node) | CPU | **✅ 实际路径**，RTF ~1.0 单 CPU 即可实时 |
| VoxCPM (PyTorch) | CPU | GPU segfault |
| VoxCPM (Python ONNX CPU, sequential load) | CPU | ✅ **当前路径**，顺序加载模型（VAE→Prefill→Decode→VAE）避免 OOM，24GB 模型分时加载，RTF ~7.4 |
| VoxCPM (onnxruntime-node WebGPU) | GPU (Vulkan/Dawn) | ⏸️ 暂停，VAE CPU fallback + Dawn 资源泄漏 workaround，GPU Hang 后不可用 |
| VoxCPM (onnxruntime-node CPU) | CPU | ❌ 废弃，Bun 多版本冲突 + `sharp` 依赖 + OOM（4个session同时加载24GB）|
| VoxCPM (ORT+MIGraphX) | GPU (ROCm) | ❌ 废弃，10x slower than CPU |
| CosyVoice3 | CPU | 无 CUDA EP, 编译 ORT + MIGraphX 中（但 gfx1103 MIOpen conv solver hang 可能会堵） |
| Whisper (PyTorch) | ❌ GPU segfault — 模型加载 OK，**转录** (`model.transcribe()`) 段错误；ROCm torch 2.12.0+rocm7.2 后仍未修复；永不用于 GPU |
| faster-whisper | CPU | ❌ CTranslate2 CUDA 检测无法绕过 ROCm（"CUDA driver version is insufficient"），永远 CPU fallback。注意：pip 版 CTranslate2 是 CUDA 原生构建（依赖 libcuda.so + libcudart.so），ROCm 系统无此二库。如有需要可尝试从源码构建 HIP 版。之前"正常"的记录可能有误或依赖不同环境配置 |
| whisper.cpp (whisper-cli, HIPBLAS) | CPU (`-ng`) | ❌ 废弃，gfx1103 MES firmware 0x83 `REMOVE_QUEUE` hang，长音频必然触发 |
| whisper.cpp (whisper-cli, Vulkan) | GPU (Vulkan/RADV) | ✅ **实际路径**，编译 `-DGGML_VULKAN=ON` 无需 HIP/ROCm，170s 长音频稳定无 hang；RADV 驱动 + KHR_coopmat；Radeon 780M @ 170s RTF **0.081**（16x CPU），CER 8.08%（与 CPU 同级别） |
| 翻译 | GPU (cuda) | 正常 |

详情 → `.agents/model-strategy.md`

## Key directories
- `backend/app/adapters/` — Python 模型适配器
- `packages/api/src/ml/` — TypeScript 模型实现
- `packages/benchmark/` — 性能测试
- `data/modelscope/CosyVoice3-0.5B/onnx/scripts/` — CosyVoice3 ONNX 推理脚本（零 PyTorch 依赖）
- `submodule/CosyVoice/` — FunAudioLLM CosyVoice 官方源码
- `submodule/VoxCPM/` — OpenBMB VoxCPM 官方源码
- `submodule/whisper.cpp/` — whisper.cpp 官方仓库（GPU build via Vulkan → `build/bin/whisper-vulkan`）

## Temp directory
- `packages/tmp/` — 项目级临时文件/构建产物（已 gitignored via `*/tmp/*` in `.gitignore`）
- 大型第三方编译（如 ORT 源码）放此目录而非系统 `/tmp/`

## Navigation
- `.agents/hardware.md` — GPU 兼容性 & 环境变量
- `.agents/model-strategy.md` — 各模型设备分配策略
- `.agents/conv-patch.md` — GEMM conv 替代实现
- `.agents/demucs.md` — Demucs CPU fallback 说明
- `.agents/cosyvoice2.md` — CosyVoice2/3 ONNX 导出状态
- `.agents/future-optimization.md` — 长期优化计划
- `docs/webgpu-oom.md` — WebGPU `VK_ERROR_DEVICE_LOST` 根因分析

## VoxCPM2 Benchmark (onnxruntime-node 1.26.0, Radeon 780M)

```
ts-onnx-webgpu-vulkan  RTF ~4.2  (VAE CPU + Prefill/Decode WebGPU)  ✅ 全文本
ts-onnx-cpu            RTF ~7.4  (所有模型 CPU)                       ✅ 全文本
py-pth-cpu             RTF ~9.9  (PyTorch CPU)                       ✅ 全文本
rs-onnx-cpu            RTF ~10.2 (Rust ORT 1.24, short only)         ⏳ timeout
```

## TODO

- **设备检测**：目前所有 Python 脚本和 TS 默认 `device: "cuda"`（包括 ROCm 机器），用户需自行在 config 或 env 中设为 `"cpu"` 避免 GPU hang。待实现运行时可感知的自动设备检测（检测 torch/ort 可用 EP + ROCm 标记）后再改默认值。

## Torch ROCm 安装要点
- torch 2.12.0+rocm7.2 (从 cu130 切换)
- 下载 6.2GB wheel 需 wget + resume（pip 超时），用 `--index-url https://download.pytorch.org/whl/rocm7.2`
- torchvision+torchaudio 对应 wheel 仅 3.5MB / 338KB
- `torch.cuda.is_available()` → True，`HSA_OVERRIDE_GFX_VERSION=11.0.0` 自动生效
- whisper-pytorch 模型加载 OK 但转录仍 segfault（与 CUDA torch 相同）
- faster-whisper CTranslate2 的 CUDA 检测无法绕过 ROCm（依赖 libcuda.so + libcudart.so，ROCm 系统无此二库），永远 CPU fallback

## Known limits (27GB RAM + swap)
- **daemon OOM 边界**：ML daemon 进程内缓存 ≥2 个模型（CPU）且总 RSS > 9.5GB 时可能 OOM。详情 → `packages/research/model-load-benchmarks.md`

## 已知问题
- **Dawn WebGPU 多 session 资源泄漏**：≥3 个 WebGPU InferenceSession 共存会导致 `VK_ERROR_DEVICE_LOST`。Workaround: VAE Encoder/Decoder 用 CPU EP，限制 WebGPU sessions ≤ 2 个。用完调用 `session.release()` 释放资源。
  - 详情 → `docs/webgpu-oom.md`
- MIGraphX 路径废弃（10x slower than CPU, MIOpen conv solver hang）
- **whisper.cpp GPU 构建需要同时设置 `-DGGML_HIPBLAS=ON -DGGML_HIP=ON`**，仅设 `GGML_HIPBLAS` 时 `use_gpu=0`（CPU fallback）。**Vulkan 编译无需 HIP**，用 `-DGGML_VULKAN=ON -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++` 即可。
- **MES 0x83 REMOVE_QUEUE hang**：gfx1103 (RDNA 3) 使用 MES firmware 0x83 接口，长时间连续 GPU kernel 会导致 MES 无法响应 `REMOVE_QUEUE` 消息 → 触发完整 GPU reset（`MODE2 reset`）。MES 0x80 (RDNA 2) 无此问题。whisper-cli HIPBLAS GPU 长音频（170s）必然触发此 hang。**Vulkan 后端 (RADV) 无此问题**，170s 稳定。
- whisper-pytorch GPU transcription: segfault confirmed even after ROCm torch upgrade (model load OK, `model.transcribe()` crashes)
- Rust `ort` crate v2.0.0-rc.12 bundles ORT 1.24（落后 2 个大版本），暂不适用于生产
