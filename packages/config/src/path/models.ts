import { join } from 'node:path';
import { env } from "../env";
import { homedir } from "node:os";

export const MODEL_CACHE_DIR = env.MODEL_CACHE_DIR;

export const DEMUCS_MODEL_DIR = join(MODEL_CACHE_DIR, 'demucs');
export const DEMUCS_GGML_FILE = join(DEMUCS_MODEL_DIR, 'ggml-model-htdemucs-4s-f16.bin');

export const WHISPER_MODEL_DIR = join(MODEL_CACHE_DIR, 'whisper');
export const SHERPA_MODEL_DIR = join(WHISPER_MODEL_DIR, 'sherpa_onnx');
// openai-whisper 自己管理
// export const OPENAI_WHISPER_MODEL_DIR = join(homedir(), '.cache', 'whisper');
export const whisperCppModelPath = (name='ggml-large-v3-turbo.bin') => join(WHISPER_MODEL_DIR, name);
 
export const VOXCPM_MODEL_DIR = join(MODEL_CACHE_DIR, 'voxcpm2');