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
| pytorch | cpu | short | 10.0 | 2.3 | 107.1 | 10.712 |
| pytorch | cpu | long | 120.0 | 2.3 | 1422.3 | 11.853 |

### 备注
- **PyTorch medium 失败**（91% 时出错），short & long 有效
- **加载时间**：ONNX 16.9s vs PyTorch 2.3s（PyTorch 是 Python import + demucs 模型构造；ONNX 含验证 ONNX 文件存在 + 创建 InferenceSession）
- **RTF**：ORT ~2.2 远快于 PyTorch ~11（CPU 下 ORT 优势明显）

## 环境
- CPU: AMD Radeon 780M (Demucs 全程 CPU)
- ROCm 7.2.3
- onnxruntime-node 1.26.0
- Demucs submodule (htdemucs_ft)
