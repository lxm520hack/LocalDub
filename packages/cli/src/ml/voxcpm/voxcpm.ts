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

// ---------------------------------------------------------------
// Gradio server backend
// ----------------------------------------------------------------

const newVoxCPMPyTTorchGradio = (cfg: TTSConfig): TTSBackend => {
	let cloud: VoxCPMCloud | null = null;
	let device = cfg && 'device' in cfg ? (cfg.device as string) : 'cpu';
	let modelDir = join(REPO_ROOT, 'data', 'modelscope', 'OpenBMB__VoxCPM2');
	let port = 19112;
	let proc: ChildProcess | null = null;
	return {
		name: 'voxcpm_torch_gradio',
		async load(): Promise<void> {
			console.log(`[VoxCPM] connecting to Gradio server on port ${port}...`);
			// Ensure model downloaded
			const ensureScript = join(REPO_ROOT, 'packages', 'cli', 'src', 'ml', 'voxcpm', 'ensure_voxcpm.py');
			const procEnsure = spawn(pythonBin(), [ensureScript, 'OpenBMB/VoxCPM2', modelDir], { timeout: 1_800_000 });
			procEnsure.stderr?.pipe(process.stderr);
			await new Promise<void>((resolve, reject) => {
				procEnsure.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ensure_voxcpm.py exited ${code}`)));
				procEnsure.on('error', reject);
			});

			// Try existing server first
			const baseUrl = `http://127.0.0.1:${port}`;
			let serverUrl: string | null = null;
			try {
				const res = await fetch(`${baseUrl}/status`, { signal: AbortSignal.timeout(2000) });
				if (res.ok) serverUrl = baseUrl;
			} catch { /* not running */ }

			if (!serverUrl) {
				// Spawn Gradio server
				const serverScript = join(REPO_ROOT, 'packages', 'voxcpm_torch_server', 'server.py');
				proc = spawn(pythonBin(), [
					serverScript, '--port', String(port),
					'--device', device, '--model-dir', modelDir,
				], {
					env: { ...process.env as Record<string, string> },
					stdio: ['ignore', 'pipe', 'pipe'],
				});

				serverUrl = await new Promise<string>((resolve, reject) => {
					const deadline = Date.now() + 120_000;
					let stdout = '';
					proc!.stdout?.on('data', (chunk: Buffer) => {
						stdout += chunk.toString();
						const m = stdout.match(/Running on local URL:\s*(\S+)/);
						if (m) resolve(m[1].replace(/\/+$/, ''));
					});
					proc!.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
					proc!.on('error', reject);
					proc!.on('exit', (code) => reject(new Error(`VoxCPM Gradio exited ${code}`)));
					setTimeout(() => reject(new Error('VoxCPM Gradio startup timeout')), deadline - Date.now());
				});
			}

			// Load model via dedicated endpoint
			const loadRes = await fetch(`${serverUrl}/load-model`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ device }),
			});
			if (!loadRes.ok) throw new Error(`VoxCPM load-model failed: ${loadRes.status}`);

			cloud = new VoxCPMCloud({ apiUrl: serverUrl });
			await cloud.load();
		},
		async generate(options: Parameters<TTSBackend['generate']>[0]): ReturnType<TTSBackend['generate']> {
			if (!cloud) throw new Error('VoxCPMGradio not loaded');
			return cloud.generate(options);
		},
		async dispose(): Promise<void> {
			await cloud?.dispose();
			if (proc) {
				proc.stdout?.destroy();
				proc.stderr?.destroy();
				proc = null;
			}
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