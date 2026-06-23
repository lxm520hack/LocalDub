import {
	VoxCPMCloud,
	VoxCPMNodeONNX,
	VoxCPMPython,
	writeWav,
} from '@repo/voxlab';
import type { TTSBackend } from '@repo/voxlab';
import type { TTSConfig } from '../../feat/config/types.ts';

export type { TTSBackend } from '@repo/voxlab';

function createBackend(cfg: TTSConfig): TTSBackend {
	if (!cfg) throw new Error('TTS config not found');
	if (cfg.runtime === 'cloud') return new VoxCPMCloud();
	if (cfg.runtime === 'pytorch') return new VoxCPMPython();
	const device =
		'device' in cfg ? (cfg.device === 'webgpu' ? 'webgpu' : 'cpu') : 'cpu';
	return new VoxCPMNodeONNX({ executionProvider: device });
}

export class VoxCPMEngine {
	private backend: TTSBackend | null = null;
	private cfg: TTSConfig;

	constructor(cfg: TTSConfig) {
		this.cfg = cfg;
	}

	async load(): Promise<void> {
		this.backend = createBackend(this.cfg);
		await this.backend.load();
	}

	async synthesize(
		text: string,
		refWav: string,
		promptText?: string,
	): Promise<Float32Array> {
		if (!this.backend) throw new Error('VoxCPMEngine not loaded');
		const { samples } = await this.backend.generate({
			text,
			referenceWavPath: refWav,
			promptText,
		});
		return samples;
	}

	async release(): Promise<void> {
		if (this.backend) {
			await this.backend.dispose();
			this.backend = null;
		}
	}
}
