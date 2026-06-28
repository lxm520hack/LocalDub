# LocalDub

CLI 核心：视频配音流水线。支持分离 / ASR / 翻译 / TTS / 合成。

## 快速开始

### 前置依赖

- **Python 3.12+**
- **FFmpeg + ffprobe**（需在 `PATH` 中）
- **Bun**（Node.js 运行时，[安装](https://bun.sh/docs/installation)）
- **OpenAI 兼容的翻译 API**

安装系统依赖：

```bash
# Ubuntu / Debian
sudo apt install -y ffmpeg

# Arch
sudo pacman -S ffmpeg

# macOS (Homebrew)
brew install ffmpeg

# Windows (winget)
winget install Gyan.FFmpeg
```

### 自动安装

```bash
git clone https://github.com/Nahida-aa/LocalDub.git
cd LocalDub
git submodule update --init --recursive
bash scripts/setup.sh
```

Windows 用 PowerShell:

```powershell
.\scripts\setup.ps1
```

安装脚本会自动：
1. 检测 GPU（CUDA / ROCm / CPU）
2. 创建 Python 虚拟环境 `.venv`
3. 安装 Python 依赖（含对应设备的 PyTorch）
4. `bun install`

### 手动安装

```bash
uv venv
source .venv/bin/activate
uv pip install ".[demucs,voxcpm]"      # setup.sh 会自动选 GPU 索引，手动装需指定:
# CPU 版:   uv pip install ".[demucs,voxcpm]" --index-url https://download.pytorch.org/whl/cpu
# CUDA:     uv pip install ".[demucs,voxcpm]"   (默认)
# ROCm:     uv pip install ".[demucs,voxcpm]"   (默认)
bun install
```

```powershell
# Windows
uv venv
.\.venv\Scripts\Activate.ps1
uv pip install ".[demucs,voxcpm]"
bun install
```

### 配置

复制 `.env.example` 为 `.env`，填入翻译 API 信息：

```
# Ollama 本地代理（无需 API key）
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_MODEL=gemma4:31b-cloud

# 或 OpenAI API
# OPENAI_API_KEY=sk-...
```

编辑 `packages/cli/config.json` 设置视频链接和引擎选择。

### 运行

```bash
cd packages/cli
bun run run-task.ts
```

---

## 设备说明

### NVIDIA (CUDA)

`openai-whisper`（默认 ASR）自动使用 CUDA。Demucs 自动使用 CUDA。setup.sh 会安装 CUDA 版 PyTorch。

### AMD (ROCm)

ROCm 机器上 `faster-whisper` 走 CUDA 转译层，工作正常。Demucs 建议指定 `device: "cpu"`（GPU hang 风险，见 `.agents/hardware.md`）。

TTS 建议使用 `runtime: "cloud"`（VoxCPM Cloud API），避免本地加载 PyTorch 模型。

**已知问题：**
- Demucs GPU → hang（htdemucs, shifts=3）
- Whisper PyTorch GPU → segfault
- VoxCPM PyTorch GPU → segfault

解决方案：`config.json` 中设 `"device": "cpu"` 或使用 cloud TTS。

### CPU only

所有组件均支持 CPU 运行，但 ASR 和分离会慢 2-10 倍。安装时使用 CPU 索引：

```bash
uv pip install ".[demucs,voxcpm]" --index-url https://download.pytorch.org/whl/cpu
```

### macOS

`faster-whisper` 和 Demucs 仅支持 CPU。MPS 后端未经测试。

---

## 项目结构

```
packages/
  cli/        CLI 入口、流水线编排、stage 实现
  voxlab/     TTS 引擎适配（cloud / pytorch / onnx）
  config/     环境变量、路径常量
  device/     GPU 检测（CUDA / ROCm / Vulkan）
  shared/     应用开发共享代码(一般不修改)
```
