# WebGPU VK_ERROR_DEVICE_LOST 分析

## 现象

在 `onnxruntime-node` WebGPU EP 上运行 VoxCPM2 全流程时，**短文本**可以正常生成，但**中/长文本**抛出：

```
radv/amdgpu: The CS has been cancelled because the context is lost. This context is innocent.
VK_ERROR_DEVICE_LOST
```

进程崩溃，无法恢复。

## 根因：Dawn/ORT 多 WebGPU Session 资源泄漏

### 隔离测试结果

| 测试 | 结果 |
|------|------|
| VAE Encoder **单独** WebGPU (12s audio) | ✅ 0.81s |
| VAE Decoder **单独** WebGPU (270 patches) | ✅ 2.10s |
| VAE Enc → VAE Dec 顺序 WebGPU（无 release） | ❌ "innocent context" |
| VAE Enc → **release()** → VAE Dec | ✅ |
| 全流程 VAE **CPU** + transformer WebGPU（2 sessions） | ✅ RTF ~4.2 |

### 结论：不是 OOM，不是 GPU hang

1. 你的 Radeon 780M 有 4GB UEFI VRAM carveout + 14.5GB GTT。Vulkan DEVICE_LOCAL heap = **11.73 GiB**。
2. VAE 模型中间 tensor 约几十 MB，远不足以撑爆。
3. VAE Decoder 270 patches **单独跑 2.10s 成功**——如果真是 OOM，怎么跑都会失败。
4. 根因是 **Dawn WebGPU EP 的 session 资源泄漏**：多个 WebGPU InferenceSession 创建后，Dawn 的 GPU 资源（command pools, buffer manager）不能完全释放，累积到某个阈值后 Vulkan 设备被重置。
5. 具体阈值：**>= 3 个同时存活的 WebGPU sessions** 会导致泄漏累积。

### 解决：VAE CPU + transformer WebGPU（2 sessions limit）

减少 WebGPU session 数量：

| 模型 | EP |
|------|----|
| VAE Encoder | CPU |
| VAE Decoder | CPU |
| Prefill (2B) | WebGPU |
| Decode Step | WebGPU |

同时使用 `session.release()` 在每次 `generate()` 末尾释放 VAE session 资源，避免多次调用时的累积。

### 为什么 MIGraphX 也遇到类似问题

MIGraphX EP 的 VAE Encoder 曾因 MIOpen `GemmFwdRest` solver 在 gfx1103 上 hang，是 **MIOpen 的 conv solver bug**，不同的根因。

## Benchmark 结果

```
ts-onnx-webgpu-vulkan  RTF ~4.2  (VAE CPU + transformer WebGPU)
ts-onnx-cpu            RTF ~7.4  (CPU only)
py-pth-cpu             RTF ~9.9  (PyTorch CPU)
rs-onnx-cpu            RTF ~10.2 (Rust ORT 1.24, short only)
```

WebGPU 路径比 Pure CPU 快 1.7x，比 PyTorch CPU 快 2.4x。
