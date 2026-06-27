import {
	VoxCPMCloud,
	VoxCPMNodeONNX,
	VoxCPMPython,
	writeWav,
} from '@repo/voxlab';
import type { TTSBackend } from '@repo/voxlab';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { pythonBin, REPO_ROOT } from '../../feat/config/config.ts';
import type { TTSConfig } from '../../feat/config/types.ts';

export type { TTSBackend } from '@repo/voxlab';

// ---------------------------------------------------------------------------
// Gradio server backend
// ---------------------------------------------------------------------------

class VoxCPMGradio implements TTSBackend {
	readonly name = 'voxcpm_torch_gradio';
	private cloud: VoxCPMCloud | null = null;
	private proc: ChildProcess | null = null;
	private device: string;
	private modelDir: string;
	private port: number;

	constructor(cfg: TTSConfig) {
		this.device = cfg && 'device' in cfg ? (cfg.device as string) : 'cpu';
		this.modelDir = join(REPO_ROOT, 'data', 'modelscope', 'OpenBMB__VoxCPM2');
		this.port = 19112;
	}

	async load(): Promise<void> {
		// Ensure model downloaded
		const ensureScript = join(REPO_ROOT, 'packages', 'cli', 'src', 'ml', 'voxcpm', 'ensure_voxcpm.py');
		const procEnsure = spawn(pythonBin(), [ensureScript, 'OpenBMB/VoxCPM2', this.modelDir], { timeout: 1_800_000 });
		procEnsure.stderr?.pipe(process.stderr);
		await new Promise<void>((resolve, reject) => {
			procEnsure.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ensure_voxcpm.py exited ${code}`)));
			procEnsure.on('error', reject);
		});

		// Try existing server first
		const baseUrl = `http://127.0.0.1:${this.port}`;
		let url: string | null = null;
		try {
			const res = await fetch(`${baseUrl}/gradio_api/api_info`, { signal: AbortSignal.timeout(2000) });
			if (res.ok) url = baseUrl;
		} catch { /* not running */ }

		if (!url) {
			// Spawn Gradio server
			const serverScript = join(REPO_ROOT, 'packages', 'voxcpm_torch_server', 'server.py');
			const proc = spawn(pythonBin(), [
				serverScript, '--port', String(this.port),
				'--device', this.device, '--model-dir', this.modelDir,
			], {
				env: { ...process.env as Record<string, string> },
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			this.proc = proc;

			url = await new Promise<string>((resolve, reject) => {
				const deadline = Date.now() + 120_000;
				let stdout = '';
				proc.stdout?.on('data', (chunk: Buffer) => {
					stdout += chunk.toString();
					const m = stdout.match(/Running on local URL:\s*(\S+)/);
					if (m) resolve(m[1].replace(/\/+$/, ''));
				});
				proc.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
				proc.on('error', reject);
				proc.on('exit', (code) => reject(new Error(`VoxCPM Gradio exited ${code}`)));
				setTimeout(() => reject(new Error('VoxCPM Gradio startup timeout')), deadline - Date.now());
			});
		}

		this.cloud = new VoxCPMCloud({ apiUrl: url });
		await this.cloud.load();
	}

	async generate(options: Parameters<TTSBackend['generate']>[0]): ReturnType<TTSBackend['generate']> {
		if (!this.cloud) throw new Error('VoxCPMGradio not loaded');
		return this.cloud.generate(options);
	}

	async dispose(): Promise<void> {
		await this.cloud?.dispose();
		if (this.proc) {
			this.proc.stdout?.destroy();
			this.proc.stderr?.destroy();
			this.proc = null;
		}
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createBackend(cfg: TTSConfig): TTSBackend {
	if (!cfg) throw new Error('TTS config not found');
	if (cfg.runtime === 'cloud') return new VoxCPMCloud();
	if (cfg.runtime === 'pytorch') return new VoxCPMPython();
	if (cfg.runtime === 'voxcpm_torch_gradio') return new VoxCPMGradio(cfg);
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
