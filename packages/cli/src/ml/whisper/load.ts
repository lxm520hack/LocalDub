import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WHISPER_MODEL_DIR } from '@repo/config/path/models';

const WHISPER_MODEL_PATH = WHISPER_MODEL_DIR;

export interface ModelStatus {
	exists: boolean;
	isReady: boolean;
	missingFiles: string[];
}

const REQUIRED_FILES = [
	'onnx/encoder_model.onnx',
	'onnx/encoder_model.onnx_data',
	'onnx/decoder_model_merged.onnx',
	'tokenizer.json',
	'vocab.json',
];

export async function checkWhisperStatus(): Promise<ModelStatus> {
	const missingFiles: string[] = [];
	for (const file of REQUIRED_FILES) {
		if (!existsSync(join(WHISPER_MODEL_PATH, file))) {
			missingFiles.push(file);
		}
	}
	return {
		exists: missingFiles.length < REQUIRED_FILES.length,
		isReady: missingFiles.length === 0,
		missingFiles,
	};
}
