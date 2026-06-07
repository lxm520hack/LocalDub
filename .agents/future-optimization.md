# Future optimization (long videos)

- Lower-hanging fruit: reduce `segment` (currently 7.8s) to reduce padding overhead.
- Rust reimplementation of Demucs' LSTM-free path (conv + transformer): all ops are GEMM-amenable (conv1d/conv2d → im2col + matmul; transformer → matmul+bmm+softmax+layernorm).
- Candle (Rust ML framework) could be a starting point if `HSA_OVERRIDE_GFX_VERSION` continues to work for basic matmul.

## TS VoxCPM roadmap

1. 调通 stop_flag 使解码在合适位置停止
2. 尝试 webgpu 执行提供器加速
3. 与 Python VoxCPM 做性能对比 benchmark
4. 根据对比结果决定是否渐进式替代 Python 端
