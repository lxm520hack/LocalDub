import { z } from "zod";

export const envDescribeMap = {
  bun: {
    en: 'ts(nodejs) runtime, package manager',
    zh: 'ts(nodejs) 运行时, 包管理器',
    required: true,
    category: 'core',
  },
  python: {
    en: 'python runtime (>= 3.10)',
    zh: 'python 运行时 (>= 3.10)',
    required: true,
    category: 'core',
  },
  uv: {
    en: 'python package manager',
    zh: 'python 包管理器',
    required: true,
    category: 'core',
  },
  ffmpeg: {
    en: 'video/audio processing tool (with libx264, libmp3lame)',
    zh: '视频/音频处理工具 (需 libx264, libmp3lame)',
    required: true,
    category: 'core',
  },
  cargo: {
    en: 'rust package manager, needed for building burn backends',
    zh: 'rust 包管理器, 编译 burn 后端需要',
    required: false,
    category: 'optional',
  },
  vcpkg: {
    en: 'c++ package manager, only needed on windows for OCR build',
    zh: 'c++ 包管理器, 仅 windows 上 OCR 编译需要',
    required: false,
    category: 'windows-only',
  },
  vulkan: {
    en: 'vulkan GPU driver, needed for wgpu backend',
    zh: 'vulkan GPU 驱动, wgpu 后端需要',
    required: false,
    category: 'optional',
  },
  rocm: {
    en: 'rocm GPU driver, needed for rocm backend (AMD)',
    zh: 'rocm GPU 驱动, rocm 后端需要 (AMD)',
    required: false,
    category: 'optional',
  },
  cuda: {
    en: 'nvidia CUDA driver + nvidia-smi',
    zh: 'nvidia CUDA 驱动 + nvidia-smi',
    required: false,
    category: 'optional',
  },
  libtorch: {
    en: 'libtorch shared library, needed for burn-tch backend',
    zh: 'libtorch 动态库, burn-tch 后端需要',
    required: false,
    category: 'optional',
  },
  whisper_ggml: {
    en: 'whisper.cpp ggml model (data/models/whisper/ggml-large-v3-turbo.bin)',
    zh: 'whisper.cpp ggml 模型 (data/models/whisper/ggml-large-v3-turbo.bin)',
    required: false,
    category: 'optional',
  },
  whisper_vad: {
    en: 'silero VAD model (data/models/whisper/ggml-silero-v6.2.0.bin)',
    zh: 'silero VAD 模型 (data/models/whisper/ggml-silero-v6.2.0.bin)',
    required: false,
    category: 'optional',
  },
  whisper_sherpa: {
    en: 'sherpa-onnx whisper model (data/models/whisper/sherpa_onnx/)',
    zh: 'sherpa-onnx whisper 模型 (data/models/whisper/sherpa_onnx/)',
    required: false,
    category: 'optional',
  },
  whisper_onnx: {
    en: 'onnx-community whisper model (data/models/whisper/encoder_model.onnx)',
    zh: 'onnx-community whisper 模型 (data/models/whisper/encoder_model.onnx)',
    required: false,
    category: 'optional',
  },
  demucs_pth: {
    en: 'demucs safetensors model, used for separate burn backend',
    zh: 'demucs safetensors 模型, 用于 separate burn 后端',
    required: false,
    category: 'optional',
  },
  demucs_onnx: {
    en: 'demucs onnx model files, used for onnx separate',
    zh: 'demucs onnx 模型文件, 用于 onnx separate',
    required: false,
    category: 'optional',
  },
  voxcpm2_pth: {
    en: 'voxcpm2 torch model file (model.safetensors + audiovae.pth), used for tts',
    zh: 'voxcpm2 torch 模型文件 (model.safetensors + audiovae.pth), 用于 tts',
    required: false,
    category: 'optional',
  },
  dotenv: {
    en: '.env configuration file with DEVICE, API keys, etc.',
    zh: '.env 配置文件, 包含 DEVICE, API 密钥等',
    required: false,
    category: 'recommended',
  },
} as const;

type EnvDescribeMap = typeof envDescribeMap;
export type EnvName = keyof EnvDescribeMap;
export const envList = Object.keys(envDescribeMap) as EnvName[];

export const EnvArgsSchema = z.object({
  action: z.enum(['check', 'ensure']).default('check').optional(),
  targets: z.array(z.string()).default([]).optional(),
});
