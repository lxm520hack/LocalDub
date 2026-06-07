import { readFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { REPO_ROOT, env } from '@repo/config';
import type { EnginesConfig, SeparateEngineConfig, ASREngineConfig, TTSEngineConfig, TranslateEngineConfig } from './types.ts';

export type { EnginesConfig, SeparateEngineConfig, ASREngineConfig, TTSEngineConfig, TranslateEngineConfig };
export { REPO_ROOT, delimiter };

export function pythonBin(): string {
  const isWin = process.platform === 'win32';
  return join(REPO_ROOT, '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
}

const CONFIG_PATH = join(REPO_ROOT, 'packages', 'cli', 'config.json');

export function readEnginesConfig(path?: string): EnginesConfig {
  const configPath = path ?? CONFIG_PATH;
  let file: any = {};
  try {
    file = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch { /* use defaults */ }
  const e = file.engines ?? {};
  return {
    tts: { runtime: e.tts?.runtime ?? 'pytorch', device: e.tts?.device ?? 'cuda' },
    asr: { runtime: e.asr?.runtime ?? 'pytorch', device: e.asr?.device ?? 'cuda' },
    translate: { apiBase: e.translate?.apiBase ?? env.OPENAI_BASE_URL, model: e.translate?.model ?? env.OPENAI_MODEL },
    separate: { runtime: e.separate?.runtime ?? 'ort', device: e.separate?.device ?? 'cpu' },
  };
}
