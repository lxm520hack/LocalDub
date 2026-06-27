import {
	VoxCPMCloud,
	VoxCPMNodeONNX,
	VoxCPMPython,
	writeWav,
} from '@repo/voxlab';
import type { TTSBackend } from '@repo/voxlab';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { TTSConfig } from '../../feat/input/types.ts';
import { to } from '@repo/shared/lib/utils/try.ts';
import { startVoxCPMTorchGradioServer, voxcpmTorchGradioStatus, loadVoxCPMTorchGradioModel, connectToVoxCPMTorchGradioServer } from './runtime/VoxCPMPyTTorchGradio.ts';

export type { TTSBackend } from '@repo/voxlab';

// ---------------------------------------------------------------
// Gradio server backend
// ----------------------------------------------------------------

const newVoxCPMPyTTorchGradio = (cfg: TTSConfig): TTSBackend => {
	let cloud: VoxCPMCloud | null = null;
	let device = cfg && 'device' in cfg ? (cfg.device as string) : 'cpu';
	let port = 19112;
	return {
		name: 'voxcpm_torch_gradio',
		async load(): Promise<void> {
			console.log(`[VoxCPM] connecting to Gradio server on port ${port}...`);

		const ret = await	connectToVoxCPMTorchGradioServer({ baseUrl: `http://127.0.0.1:${port}`, device });

			cloud = new VoxCPMCloud({ apiUrl: ret?.url });
			await cloud.load();
		},
		async generate(options: Parameters<TTSBackend['generate']>[0]): ReturnType<TTSBackend['generate']> {
			if (!cloud) throw new Error('VoxCPMGradio not loaded');
			return cloud.generate(options);
		},
		async dispose(): Promise<void> {
			await cloud?.dispose();
		}
	}
}


// ----------------------------------------------------------------
// Factory
// ----------------------------------------------------------------

function createBackend(cfg: TTSConfig): TTSBackend {
	if (!cfg) throw new Error('TTS config not found');
	if (cfg.runtime === 'cloud') return new VoxCPMCloud();
	if (cfg.runtime === 'pytorch') return new VoxCPMPython();
	if (cfg.runtime === 'voxcpm_torch_gradio') return newVoxCPMPyTTorchGradio(cfg);
	const device =
		'device' in cfg ? (cfg.device === 'webgpu' ? 'webgpu' : 'cpu') : 'cpu';
	return new VoxCPMNodeONNX({ executionProvider: device });
}

export const newVoxCPMEngine = (cfg: TTSConfig) => {
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