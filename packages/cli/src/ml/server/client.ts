import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { delimiter, pythonBin, REPO_ROOT } from '../../feat/config/config.ts';

const DEFAULT_PORT = 19109;

type ProgressCallback = (current: number, total: number, message?: string) => void;

export interface TorchServerConnection {
	baseUrl: string;
	proc?: ChildProcess;
}

function readSSE(
	stream: ReadableStream<Uint8Array>,
	onProgress?: ProgressCallback,
): Promise<{ ok: true; output: Record<string, unknown> } | { ok: false; message: string }> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let currentEvent = '';
	let currentData = '';

	function dispatch() {
		if (currentEvent === 'progress') {
			const d = JSON.parse(currentData);
			onProgress?.(d.current, d.total, d.message);
			return null;
		}
		if (currentEvent === 'complete') {
			return { ok: true as const, output: JSON.parse(currentData).output ?? {} };
		}
		if (currentEvent === 'error') {
			return { ok: false as const, message: JSON.parse(currentData).message ?? 'Unknown error' };
		}
		return null;
	}

	return new Promise((resolve, reject) => {
		function pump() {
			reader.read().then(({ done, value }) => {
				if (done) {
					resolve({ ok: false, message: 'SSE stream ended without complete/error' });
					return;
				}
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n');
				buffer = parts.pop() ?? '';
				for (const line of parts) {
					if (line.startsWith('event: ')) {
						currentEvent = line.slice(7).trim();
					} else if (line.startsWith('data: ')) {
						currentData = line.slice(6).trim();
					} else if (line === '' && currentEvent) {
						const result = dispatch();
						if (result) {
							resolve(result);
							reader.cancel();
							return;
						}
						currentEvent = '';
						currentData = '';
					}
				}
				pump();
			}).catch(reject);
		}
		pump();
	});
}

async function healthCheck(baseUrl: string): Promise<boolean> {
	try {
		const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
		return res.ok;
	} catch {
		return false;
	}
}

export async function startTorchServer(port: number = DEFAULT_PORT): Promise<TorchServerConnection> {
	const baseUrl = `http://127.0.0.1:${port}`;

	// 1) Try existing server
	if (await healthCheck(baseUrl)) {
		console.log(`[TorchServer] Connected to existing server at ${baseUrl}`);
		return { baseUrl };
	}

	// 2) Spawn detached Torch server
	console.log('[TorchServer] Spawning ML torch server...');
	const pyBin = pythonBin();
	const scriptPath = join(
		REPO_ROOT, 'packages', 'cli', 'src', 'ml', 'server', 'pytorch_server.py',
	);
	const voxcpmSrc = join(REPO_ROOT, 'submodule', 'VoxCPM', 'src');

	const env: Record<string, string> = {
		...(process.env as Record<string, string>),
		TORCHAUDIO_USE_BACKEND: 'soundfile',
	};
	const existingPy = env.PYTHONPATH || '';
	env.PYTHONPATH = existingPy ? `${voxcpmSrc}${delimiter}${existingPy}` : voxcpmSrc;

	const proc = spawn(pyBin, [scriptPath, '--http-port', String(port)], {
		env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
	});
	proc.stderr?.pipe(process.stderr);
	proc.unref();

	// 3) Poll health endpoint until ready
	const deadline = Date.now() + 60000;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 200));
		if (await healthCheck(baseUrl)) {
			console.log(`[TorchServer] Server ready at ${baseUrl} (pid ${proc.pid})`);
			return { baseUrl, proc };
		}
	}

	throw new Error(`TorchServer startup timeout after 60000ms`);
}

export async function stopTorchServer(torchServer: TorchServerConnection): Promise<void> {
	try {
		await fetch(`${torchServer.baseUrl}/api/shutdown`, { method: 'POST' });
	} catch {
		// already gone
	}
	if (torchServer.proc) {
		torchServer.proc.stdout?.destroy();
		torchServer.proc.stderr?.destroy();
	}
}

export async function runStage(
	torchServer: TorchServerConnection,
	stage: string,
	taskId: string,
	params: Record<string, unknown>,
	onProgress?: ProgressCallback,
): Promise<Record<string, unknown>> {
	const res = await fetch(`${torchServer.baseUrl}/api/run/${stage}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ task_id: taskId, params }),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`TorchServer HTTP ${res.status}: ${text}`);
	}
	if (!res.body) throw new Error('TorchServer returned empty response body');

	const result = await readSSE(res.body, onProgress);
	if (result.ok) return result.output;
	throw new Error(result.message);
}
