import { join } from 'node:path';
import { env } from './env.ts';
import { REPO_ROOT } from './root.ts';

export function pythonBin(): string {
	const isWin = process.platform === 'win32';
	return join(
		REPO_ROOT,
		'.venv',
		isWin ? 'Scripts' : 'bin',
		isWin ? 'python.exe' : 'python',
	);
}

export const WORKFOLDER = env.WORKFOLDER;
export const DATA_DIR = join(REPO_ROOT, 'data');
export const MODEL_CACHE_DIR = env.MODEL_CACHE_DIR;
export const COOKIE_DIR = join(DATA_DIR, 'cookies');
export const YOUTUBE_COOKIE_PATH = join(COOKIE_DIR, 'youtube.txt');
export const LOG_DIR = join(DATA_DIR, 'logs');

export const VOXCPM_DIR = join(MODEL_CACHE_DIR, 'OpenBMB__VoxCPM2');
export const WHISPER_ONNX_DIR = join(MODEL_CACHE_DIR, 'whisper-large-v3-turbo');
export const SHERPA_WHISPER_DIR = join(MODEL_CACHE_DIR, 'sherpa-whisper-turbo');
export const DEMUCS_DIR = join(MODEL_CACHE_DIR, 'demucs');
export const COSYVOICE_DIR = join(MODEL_CACHE_DIR, 'CosyVoice3-0.5B');
