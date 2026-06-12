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
| whisper.cpp ASR | Vulkan (RADV) | **实际路径**，RTF ~0.09-0.11 (参数相关)，large-v3-turbo |
| Demucs (ONNX, onnxruntime-node) | CPU | **实际路径**，RTF ~1.0 |
| CosyVoice3 TTS | CPU | 无可用 GPU EP |
| 翻译 | CUDA | 正常 |

❌ 失败的：whisper-pytorch GPU segfault、faster-whisper GPU 缺 libcuda.so、whisper.cpp HIPBLAS MES hang、VoxCPM 所有路径均已废弃。详细原因 → `.agents/hardware.md` / `.agents/model-strategy.md`

## Temp directory

- `packages/tmp/` — 临时文件/构建产物（gitignored via `*/tmp/*`）
- 大型第三方编译（如 ORT 源码）放此目录而非系统 `/tmp/`

## ASR evaluation

### Script

`packages/benchmark/ref/compute/eval-asr.ts` — unified ASR evaluation with text normalization.

Usage:
```
bun eval-asr.ts <hyp.json> [gt.json] [--label <label>]
bun eval-asr.ts --batch <results_dir> [gt.json]
```

Normalization rules:
1. `师父` → `师傅` (homophone unification)
2. Strip whitespace & punctuation
3. Numerals (Arabic + Chinese) → `#` placeholder

### Caveat on timestamp offset

Offset (e.g. start +200ms, end -130ms) is **not necessarily a timing error**. ASR systematically skips filler words (`啊`, `嗯`, `哎`, `哈哈哈`, `啊啊`) and low-volume speech at segment boundaries. This causes:
- Positive start offset: ASR starts later because it dropped leading filler
- Negative end offset: ASR ends earlier because it dropped trailing filler

These offsets appear even when the ASR timing is perfect. They should not be penalized as timing errors unless the content difference confirms misalignment. Always check `missed` segments — if they are filler-only, the offset is likely justified.

### Cross-source findings (sidechain vs raw vs vocals)

Sidechain processing is **critical** for `temp-*` parameters — without it, segment count collapses and timing becomes unusable:

| Params | Audio | normCER | Segs | s_off | Det. | Cover | Gaps | Gap avg |
|--------|-------|---------|------|-------|------|-------|------|---------|
| vad-v6-th02 | sidechain | **8.41%** | 88 | -534ms | 100% | 95.7% | 2 | 3.7s |
| vad-v6-th02 | raw | 13.06% | 91 | -737ms | 100% | 100% | 0 | — |
| vad-v6 | sidechain | 12.52% | 88 | -584ms | 100% | 100% | 0 | — |
| vad-v6 | raw | 14.49% | 87 | -884ms | 100% | 100% | 0 | — |
| vad-default | sidechain | 14.67% | 82 | -849ms | 100% | 100% | 0 | — |
| vad-default | raw | 22.36% | 76 | -1145ms | 100% | 100% | 0 | — |
| temp-02 | sidechain | **9.48%** | 86 | +203ms | 94.7% | 54.4% | 83 | 0.93s |
| temp-02 | raw | **15.92%** | **48** | -2342ms | 100% | 93.0% | 46 | 4.3s |
| temp-02 | vocals | **14.31%** | **16** | -6357ms | 94.7% | 77.3% | 15 | 3.3s |
| temp-04 | sidechain | 9.48% | 86 | +204ms | 94.7% | 54.4% | 83 | 0.93s |
| temp-04 | raw | 10.55% | 84 | +175ms | 94.7% | 54.6% | 80 | 0.95s |
| temp-04 | vocals | **16.99%** | **20** | -5887ms | 98.7% | 81.3% | 18 | 1.8s |

Key: `temp-*` params are extremely sensitive to BGM interference; sidechain is required. `vad-v6-th02` degrades less on raw (+4.65ppt) but still benefits from sidechain. Vocals-only makes timing worse for all params due to reduced acoustic cues at segment boundaries.

## Known limits

- **OOM**: daemon RSS > 9.5GB 时可能 OOM。详情 → `packages/research/model-load-benchmarks.md`
- **Dawn WebGPU**：≥3 sessions → `VK_ERROR_DEVICE_LOST`，限制 ≤2 个 WebGPU session
- **ffmpeg swresample whisper 幻觉循环**：sidechain 混音音频在 ffmpeg `-ar 16000` 后尾段产生 x68+ 幻觉循环。已去掉该冗余重采样，让 miniaudio 内部处理。详情 → `.agents/asr-loop-fix.md`
- **whisper.cpp 无法检测短语音**：0.5s+ 的短叹（"唉" 71.20）和轻笑（"哈哈哈" 115.42）在 38 个参数组合中几乎全部 miss。silero VAD v6 能捕获"唉"但 CER 涨 3-4ppt 且时间戳左漂 0.8-1.2s；"啊+哈哈哈"则没有任何参数能捕获——whisper 语言模型解码偏好将短语音合并入相邻段。详情 → `packages/benchmark/asr/whisper/results/FINDINGS.md`
- **VAD 变体时间戳偏移**：所有 VAD 模式都系统性地将分段边界左移（s_off_mean -0.75~-1.85s），导致字幕 timing 不准。CER 最低的 sidechain+vad-v6-th02（8.41%）偏移 -534ms。最佳平衡参数是 sidechain+temp-02（CER 9.48%，s_off +203ms，94.7% 检测率）

## OCR Pipeline

| 引擎 | 配置 | normCER | 段数 | s_off | FP | RTF |
|------|------|:-------:|:----:|:-----:|:--:|:---:|
| Python (rapidocr) | 1fps, so | 0.89% | 74 | -39ms | 0 | 0.538 |
| Python (rapidocr) | 1fps | 1.25% | 72 | -159ms | 0 | 0.538 |
| C++ ORT | 1fps, so, ts0.3 | 0.89~3.76% | 74-75 | -26ms | 0 | 0.186 |
| C++ ORT | 1fps, so, ts0.4 | 0.89~3.40% | 74-75 | -26ms | 0 | 0.186 |
| C++ ORT | 1fps, so, ts0.45 | 0.89% | 74 | -39ms | 0 | 0.186 |
| C++ ORT | 1fps, so | 1.07~5.37% | 74-76 | -26ms | 0 | 0.186 |
| Node.js (onnxruntime-node) | 1fps, so | 3.58% | 74 | -119ms | 0 | 0.263 |
| C++ ORT | 0.5fps, so | 20.75% | 54 | -639ms | 0 | 0.092 |

C++ ORT 方差全来自 ORT 多线程 run-to-run 非确定性（~0.89-5.37%），**ts 参数在 subtitleOnly 下影响被波动淹没**（27 次运行 FP=0）。所有引擎的 `subtitleOnly` → `textScore=0.3` override 已移除（C++ `ocr_pipeline.cpp:331`、Python `ocr_frame.py:29-30`、Node `ocr_node.ts:171`），`subtitleOnly` 现在只做 Y 轴裁剪。
详情 → `packages/benchmark/ocr/results/FINDINGS.md`，结果已统一用 `eval-asr.ts --ms` 评估（OCR 时间戳为毫秒）。

## TODO

- 自动设备检测：目前 default `device: "cuda"` 在 ROCm 上可能 hang，待实现运行时可感知的自动检测
- ASR 参数基准测试完成：sidechain + vad-v6-th02 最佳 CER 8.41% 但 s_off -534ms；sidechain + temp-02 最佳 timing（CER 9.48%，s_off +203ms，94.7% 检测率）。详情 → `packages/benchmark/asr/whisper/results/FINDINGS.md`
- 归一化 CER 评估脚本完善（`eval-asr.ts`）：数字归一化、同音词容差、段级偏移/检测率分析
- OCR 集成到 pipeline `ocr.ts` stage（当前为占位符）

## Navigation

- `.agents/hardware.md` — GPU 兼容性 & MES hang 根因
- `.agents/model-strategy.md` — 各模型设备分配策略 & 废弃路径详情
- `.agents/demucs.md` — Demucs CPU fallback 说明
- `.agents/cosyvoice2.md` — CosyVoice2/3 ONNX 导出状态
- `.agents/asr-loop-fix.md` — ffmpeg swresample 导致 whisper 幻觉循环根因
- `docs/webgpu-oom.md` — WebGPU `VK_ERROR_DEVICE_LOST` 根因分析
- `packages/benchmark/asr/whisper/results/FINDINGS.md` — ASR 参数基准测试详细结果（38 组合）
