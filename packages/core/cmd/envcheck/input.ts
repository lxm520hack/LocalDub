import { z } from "zod";

export const envDescribeMap = {
  bun: {
    en: 'ts(nodejs) runtime, package manager',
    zh: 'ts(nodejs) 运行时, 包管理器',
  },
  python: {
    en: 'python runtime',
    zh: 'python 运行时',
  },
  uv: {
    en: 'python package manager',
    zh: 'python 包管理器',
  },
  "cargo": {
    en: 'rust package manager',
    zh: 'rust 包管理器',
  },
  "vcpkg": {
    en: 'c++ package manager, only needed on windows',
    zh: 'c++ 包管理器, 仅 windows 需要',
  },
  "ffmpeg": {
    en: 'video/audio processing tool',
    zh: '视频/音频处理工具',
  },
  "voxcpm2_pth": {
    en: 'voxcpm2 torch model file, used for tts(tts-vc)',
    zh: 'voxcpm2 torch 模型文件, 用于 tts(tts-vc)',
  },
  "demucs_pth": {
    en: 'demucs torch model file, used for separate',
    zh: 'demucs torch 模型文件, 用于 separate',
  },
  "demucs_onnx": {
    en: 'demucs onnx model file, used for separate',
    zh: 'demucs onnx 模型文件, 用于 separate',
  },
  // ...
}
type EnvDescribeMap = typeof envDescribeMap;
export type EnvName = keyof EnvDescribeMap;
export const envList = Object.keys(envDescribeMap) as EnvName[]

export const EnvArgsSchema = z.object({
  action: z.enum(['check', 'ensure']).default('check').optional(),
  targets: z.array(z.enum(envList)).default([]).optional(), // 空=全部
})