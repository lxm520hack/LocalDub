import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEMUCS_DIR as DEMUCS_MODEL_PATH } from '@repo/config';

export { DEMUCS_MODEL_PATH };

export interface ModelStatus {
	exists: boolean;
	isReady: boolean;
	missingFiles: string[];
}

export const STEM_NAMES = ['drums', 'bass', 'other', 'vocals'] as const;
export type Stem = typeof STEM_NAMES[number];
export const STEM_FILE_NAMES: Record<Stem, string> = {
	drums: 'htdemucs_ft_drums_fp16weights.onnx',
	bass: 'htdemucs_ft_bass_fp16weights.onnx',
	other: 'htdemucs_ft_other_fp16weights.onnx',
	vocals: 'htdemucs_ft_vocals_fp16weights.onnx',
};
export const REQUIRED_FILES = Object.values(STEM_FILE_NAMES);

export async function checkDemucsStatus(stems?: readonly Stem[]): Promise<ModelStatus> {
	const targetStems = stems ?? STEM_NAMES;
	const missingFiles: string[] = [];

	let onnxReady = true;
	for (const stem of targetStems) {
		const file = STEM_FILE_NAMES[stem];
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
