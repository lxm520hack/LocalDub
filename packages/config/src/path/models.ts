import { join } from 'node:path';
import { env } from "../env";
import { homedir } from "node:os";

export const MODEL_CACHE_DIR = env.MODEL_CACHE_DIR;

export const DEMUCS_MODEL_DIR = join(MODEL_CACHE_DIR, 'demucs');

export const WHISPER_MODEL_DIR = join(MODEL_CACHE_DIR, 'whisper');
const OPENAI_WHISPER_MODEL_DIR = join(homedir(), '.cache', 'whisper');
export const SHERPA_WHISPER_DIR = join(MODEL_CACHE_DIR, 'sherpa-whisper-turbo');

export const VOXCPM_MODEL_DIR = join(MODEL_CACHE_DIR, 'voxcpm2');