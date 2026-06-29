import {
	VoxCPMCloud,
	VoxCPMNodeONNX,
	VoxCPMPython,
	writeWav,
} from '@repo/voxlab';
import type { TTSBackend } from '@repo/voxlab';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { to } from '@repo/shared/lib/utils/try.ts';

import { TTSInput } from '@repo/core/input/tts';
import { newVoxCPMPyTorchGradio } from '@repo/core/ml/voxcpm/runtime/voxcpm_torch_gradio';

export type { TTSBackend } from '@repo/voxlab';

function createBackend(cfg: TTSInput): TTSBackend {
	if (!cfg) throw new Error('TTS input not found');
	if (cfg.runtime === 'cloud') return new VoxCPMCloud();
	if (cfg.runtime === 'pytorch') return new VoxCPMPython();
	if (cfg.runtime === 'voxcpm_torch_gradio') return newVoxCPMPyTorchGradio(cfg);
	const device = cfg.device === 'webgpu' ? 'webgpu' : 'cpu'
	return new VoxCPMNodeONNX({ executionProvider: device });
}

export const newVoxCPMEngine = (cfg: TTSInput) => {
	let backend: TTSBackend | null = null;
	return {
		async load(): Promise<void> {
			backend = createBackend(cfg);
			await backend.load();
		},
		async synthesize(
			text: string,
			refWav: string,
			promptText?: string,
		): Promise<Float32Array> {
			if (!backend) throw new Error('VoxCPMEngine not loaded');
			const { samples } = await backend.generate({
				text,
				referenceWavPath: refWav,
				promptText,
			});
			return samples;
		},
		async release(): Promise<void> {
			if (backend) {
				await backend.dispose();
				backend = null;
			}
		}
	}
}