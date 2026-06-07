import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { REPO_ROOT } from './root.ts';

loadEnv({ path: resolve(REPO_ROOT, '.env') });

function envStr(key: string, fallback: string): string {
  return process.env[key]?.trim() || fallback;
}

function envStrUndefined(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

export const env = {
  // DB
  DB_FILE_NAME: resolve(REPO_ROOT, process.env.DB_FILE_NAME ?? 'data/youdub.sqlite'),

  // Paths
  WORKFOLDER: resolve(REPO_ROOT, envStr('WORKFOLDER', 'workfolder')),
  MODEL_CACHE_DIR: resolve(REPO_ROOT, envStr('MODEL_CACHE_DIR', 'data/modelscope')),

  // Device
  DEVICE: envStr('DEVICE', 'auto'),
  CUDA_DEVICE: envStrUndefined('CUDA_DEVICE'),

  // Translate API
  OPENAI_BASE_URL: envStr('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
  OPENAI_API_KEY: envStr('OPENAI_API_KEY', ''),
  OPENAI_MODEL: envStr('OPENAI_MODEL', 'gpt-4o-mini'),
  OPENAI_TRANSLATE_CONCURRENCY: parseInt(envStr('OPENAI_TRANSLATE_CONCURRENCY', '50'), 10),

  // yt-dlp
  YTDLP_PROXY_PORT: envStrUndefined('YTDLP_PROXY_PORT'),

  // FFmpeg
  FFMPEG_PATH: envStr('FFMPEG_PATH', 'ffmpeg'),
  FFPROBE_PATH: envStr('FFPROBE_PATH', 'ffprobe'),

  // CORS
  CORS_ALLOW_ORIGINS: envStrUndefined('CORS_ALLOW_ORIGINS'),
  CORS_ALLOW_ORIGIN_REGEX: envStrUndefined('CORS_ALLOW_ORIGIN_REGEX'),
} as const;
