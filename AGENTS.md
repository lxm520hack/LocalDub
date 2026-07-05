# LocalDub

- 测试/实验/探索一律不用 `/tmp`，写到 `packages/tmp/`。
- 类型检查: bun typecheck

## Key directories

- `packages/cli/` — 入口 `run-task.ts`（派发器），`src/feat/` 为 pipeline 流程实现
- `packages/core/cmd/` — CLI 命令逻辑（`tasks/task.ts` 集中派发 task 动作，含 `get_group_list`、`taskStatus` 等）
- `packages/cli/src/ml/` — 模型实现（whisper、demucs 等）
- `packages/cli/src/ml/ocr/ocr.ts` — OCR 二进制调用（ort-cpp），使用 `pythonBin()`（config.ts）而非内联 VIRTUAL_ENV
- `packages/subtitle-ocr/` — 字幕专用 OCR 包（ort-cpp、subtitle-node.ts、subtitle-py.py）
- `packages/benchmark/` — 性能测试与参数对比
- `packages/benchmark/ocr/compute/` — OCR 基准测试脚本
- `packages/benchmark/ocr/compute/postprocess_det.py` — 引用了 `packages/subtitle-ocr/ppocr_keys.json`
- `submodule/whisper.cpp/` — whisper.cpp 官方仓库（GPU Vulkan 构建 → `build/bin/whisper-vulkan`）
- `.agents/hardware.md` — 硬件兼容性 & 已知失败路径
- `.agents/model-strategy.md` — 各模型设备分配详情

## Temp directory

- `packages/tmp/` — 临时文件/构建产物（gitignored via `*/tmp/*`）
- 大型第三方编译（如 ORT 源码）放此目录而非系统 `/tmp/`

## Known limits

- **OOM**: torch server RSS > 9.5GB 时可能 OOM。详情 → `packages/research/model-load-benchmarks.md`
- **Dawn WebGPU**：≥3 sessions → `VK_ERROR_DEVICE_LOST`，限制 ≤2 个 WebGPU session
- **ffmpeg swresample whisper 幻觉循环**：sidechain 混音音频在 ffmpeg `-ar 16000` 后尾段产生 x68+ 幻觉循环。已去掉该冗余重采样，让 miniaudio 内部处理。详情 → `.agents/asr-loop-fix.md`
- **whisper.cpp 无法检测短语音**：0.5s+ 的短叹（"唉" 71.20）和轻笑（"哈哈哈" 115.42）在 38 个参数组合中几乎全部 miss。silero VAD v6 能捕获"唉"但 CER 涨 3-4ppt 且时间戳左漂 0.8-1.2s；"啊+哈哈哈"则没有任何参数能捕获——whisper 语言模型解码偏好将短语音合并入相邻段。详情 → `packages/benchmark/asr/whisper/results/FINDINGS.md`
- **VAD 变体时间戳偏移**：所有 VAD 模式都系统性地将分段边界左移（s_off_mean -0.75~-1.85s），导致字幕 timing 不准。CER 最低的 sidechain+vad-v6-th02（8.41%）偏移 -534ms。最佳平衡参数是 sidechain+temp-02（CER 9.48%，s_off +203ms，94.7% 检测率）

## Navigation

- `.agents/hardware.md` — GPU 兼容性 & MES hang 根因
- `.agents/model-strategy.md` — 各模型设备分配策略 & 废弃路径详情
- `.agents/demucs.md` — Demucs CPU fallback 说明
- `.agents/cosyvoice2.md` — CosyVoice2/3 ONNX 导出状态
- `.agents/asr-loop-fix.md` — ffmpeg swresample 导致 whisper 幻觉循环根因
- `.agents/windows-path-case.md` — Windows PATH 大小写坑 (exit=53 + 空输出)
- `docs/webgpu-oom.md` — WebGPU `VK_ERROR_DEVICE_LOST` 根因分析
- `packages/benchmark/asr/whisper/results/FINDINGS.md` — ASR 参数基准测试详细结果（38 组合）
