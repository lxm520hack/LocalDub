# Separate Benchmark — Demucs 音频分离

## 测试内容
对三段不同时长（10s / 60s / 120s）的音频（粉红噪声，16-bit 44.1kHz 单声道 WAV）进行 Demucs 4-stem 分离，提取人声 + 背景音。对比两个后端：

| 后端 | 路径 | 模型加载方式 |
|------|------|------------|
| **PyTorch** | `scripts/separate/run.py` | 每次子进程从头加载 |
| **ORT** | `Demucs` class (onnxruntime-node) | InferenceSession 创建 |

## 使用
```bash
# 跑全部后端
bun run packages/benchmark/separate/run-all.ts

# 仅 ONNX（~3 分钟）
bun run packages/benchmark/separate/run-onnx.ts
```

结果写入 `results/separate-bench.json`。

## 当前结果 (2026-06-09)

| Engine | Device | Audio | Dur(s) | Load(s) | Proc(s) | RTF |
|--------|--------|-------|--------|---------|---------|-----|
| ort | cpu | short | 10.0 | 16.9 | 21.6 | 2.161 |
| ort | cpu | medium | 60.0 | 16.9 | 142.7 | 2.379 |
| ort | cpu | long | 120.0 | 16.9 | 258.8 | 2.157 |

### 备注
- **PyTorch CPU 待测**（此前时序出错，已修 —— 缓存 bug + 加载时间分离）
- **ORT 加载时间 16.9s** 含 `checkDemucsStatus` 文件扫描 + InferenceSession 创建
- **RTF** = process_time / audio_duration，越小越好
- **`htdemucs_ft` 模型**，`shifts=3`（Demucs 默认 shifts=2，本仓库改为了 3）
- 参考音频用 ffmpeg `anoisesrc` 生成，存放在 `ref/` 目录

## 环境
- CPU: AMD Radeon 780M (Demucs 全程 CPU)
- ROCm 7.2.3
- onnxruntime-node 1.26.0
- Demucs submodule (htdemucs_ft)
