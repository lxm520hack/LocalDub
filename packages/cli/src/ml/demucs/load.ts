import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEMUCS_DIR as DEMUCS_MODEL_PATH } from '@repo/config';

export { DEMUCS_MODEL_PATH };

export interface ModelStatus {
	exists: boolean;
	isReady: boolean;
	missingFiles: string[];
}

export async function checkDemucsStatus(): Promise<ModelStatus> {
	const onnxFiles = ['htdemucs_ft_vocals.onnx'];

	const missingFiles: string[] = [];

	let onnxReady = true;
	for (const file of onnxFiles) {
		if (!existsSync(join(DEMUCS_MODEL_PATH, file))) {
			missingFiles.push(file);
			onnxReady = false;
		}
	}

	return {
		exists: onnxReady,
		isReady: onnxReady,
		missingFiles,
	};
}
