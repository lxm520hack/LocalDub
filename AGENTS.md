# LocalDub

测试/实验/探索一律不用 `/tmp`，写到 `packages/tmp/`。

## Key directories

- `packages/cli/src/feat/` — pipeline 流程（stages、config、tasks）
- `packages/cli/src/ml/` — 模型实现（whisper、demucs 等）
- `packages/benchmark/` — 性能测试与参数对比
- `submodule/whisper.cpp/` — whisper.cpp 官方仓库（GPU Vulkan 构建 → `build/bin/whisper-vulkan`）
- `.agents/hardware.md` — 硬件兼容性 & 已知失败路径
- `.agents/model-strategy.md` — 各模型设备分配详情

## Model assignment (active paths only)

| 模型 | 设备 | 说明 |
|------|------|------|
| whisper.cpp ASR | Vulkan (RADV) | **实际路径**，RTF ~0.09，large-v3-turbo |
| Demucs (ONNX, onnxruntime-node) | CPU | **实际路径**，RTF ~1.0 |
| CosyVoice3 TTS | CPU | 无可用 GPU EP |
| 翻译 | CUDA | 正常 |

❌ 失败的：whisper-pytorch GPU segfault、faster-whisper GPU 缺 libcuda.so、whisper.cpp HIPBLAS MES hang、VoxCPM 所有路径均已废弃。详细原因 → `.agents/hardware.md` / `.agents/model-strategy.md`

## Temp directory

- `packages/tmp/` — 临时文件/构建产物（gitignored via `*/tmp/*`）
- 大型第三方编译（如 ORT 源码）放此目录而非系统 `/tmp/`

## Known limits

- **OOM**: daemon RSS > 9.5GB 时可能 OOM。详情 → `packages/research/model-load-benchmarks.md`
- **Dawn WebGPU**：≥3 sessions → `VK_ERROR_DEVICE_LOST`，限制 ≤2 个 WebGPU session
- **ffmpeg swresample whisper 幻觉循环**：sidechain 混音音频在 ffmpeg `-ar 16000` 后尾段产生 x68+ 幻觉循环。已去掉该冗余重采样，让 miniaudio 内部处理。详情 → `.agents/asr-loop-fix.md`

## TODO

- 自动设备检测：目前 default `device: "cuda"` 在 ROCm 上可能 hang，待实现运行时可感知的自动检测

## Navigation

- `.agents/hardware.md` — GPU 兼容性 & MES hang 根因
- `.agents/model-strategy.md` — 各模型设备分配策略 & 废弃路径详情
- `.agents/demucs.md` — Demucs CPU fallback 说明
- `.agents/cosyvoice2.md` — CosyVoice2/3 ONNX 导出状态
- `.agents/asr-loop-fix.md` — ffmpeg swresample 导致 whisper 幻觉循环根因
- `docs/webgpu-oom.md` — WebGPU `VK_ERROR_DEVICE_LOST` 根因分析
