import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { delimiter, pythonBin, REPO_ROOT } from '../../feat/config/config.ts';

const DAEMON_PORT_DEFAULT = 19109;

type ProgressCallback = (current: number, total: number) => void;

/**
 * Parse an SSE stream from a ReadableStream<Uint8Array> into events.
 * Calls onProgress for progress events, and returns the final data for
 * complete/error events via the returned promise.
 */
function readSSE(
	stream: ReadableStream<Uint8Array>,
	onProgress?: ProgressCallback,
): Promise<{ ok: true; output: Record<string, unknown> } | { ok: false; message: string }> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let currentEvent = '';
	let currentData = '';

	function dispatch(): { ok: true; output: Record<string, unknown> } | { ok: false; message: string } | null {
		if (currentEvent === 'progress') {
			const d = JSON.parse(currentData);
			onProgress?.(d.current, d.total);
			return null; // not terminal
		}
		if (currentEvent === 'complete') {
			return { ok: true, output: JSON.parse(currentData).output ?? {} };
		}
		if (currentEvent === 'error') {
			return { ok: false, message: JSON.parse(currentData).message ?? 'Unknown error' };
		}
		return null;
	}

	return new Promise((resolve, reject) => {
		function pump(): void {
			reader.read().then(({ done, value }) => {
				if (done) {
					resolve({ ok: false, message: 'SSE stream ended without complete/error' });
					return;
				}
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n');
				buffer = parts.pop() ?? ''; // keep incomplete line
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

export class MLDaemon {
	private proc: ChildProcess | null = null;
	private _ready = false;
	private baseUrl: string;

	constructor(private port: number = DAEMON_PORT_DEFAULT) {
		this.baseUrl = `http://127.0.0.1:${port}`;
	}

	get ready() {
		return this._ready;
	}

	get pid(): number | null {
		return this.proc?.pid ?? null;
	}

	async start(timeoutMs = 60000): Promise<void> {
		if (this._ready) return;

		// 1) Try existing daemon via HTTP health endpoint
		const existing = await this.healthCheck();
		if (existing) {
			this._ready = true;
			console.log(`[Daemon] Connected to existing daemon at ${this.baseUrl}`);
			return;
		}

		// 2) Spawn detached Python daemon
		console.log('[Daemon] Spawning ML pipeline daemon...');
		const pyBin = pythonBin();
		const scriptPath = join(
			REPO_ROOT,
			'packages',
			'cli',
			'scripts',
			'pipeline_daemon.py',
		);
		const voxcpmSrc = join(REPO_ROOT, 'submodule', 'VoxCPM', 'src');

		const env: Record<string, string> = {
			...(process.env as Record<string, string>),
			TORCHAUDIO_USE_BACKEND: 'soundfile',
		};
		const existingPy = env.PYTHONPATH || '';
		env.PYTHONPATH = existingPy
			? `${voxcpmSrc}${delimiter}${existingPy}`
			: voxcpmSrc;

		this.proc = spawn(pyBin, [scriptPath, '--http-port', String(this.port)], {
			env,
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		this.proc.stderr?.pipe(process.stderr);
		this.proc.unref();

		// 3) Poll health endpoint until ready
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 200));
			if (await this.healthCheck()) {
				this._ready = true;
				console.log(`[Daemon] Daemon ready at ${this.baseUrl} (pid ${this.proc.pid})`);
				return;
			}
		}

		throw new Error(`Daemon startup timeout after ${timeoutMs}ms`);
	}

	async stop(): Promise<void> {
		try {
			await fetch(`${this.baseUrl}/shutdown`, { method: 'POST' });
		} catch {
			// daemon already gone
		}
		if (this.proc) {
			this.proc.stdout?.destroy();
			this.proc.stderr?.destroy();
		}
		this._ready = false;
		this.proc = null;
	}

	runStage(
		stage: string,
		taskId: string,
		params: Record<string, unknown>,
		onProgress?: ProgressCallback,
	): Promise<Record<string, unknown>> {
		return fetch(`${this.baseUrl}/run/${stage}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ task_id: taskId, params }),
		}).then(async (res) => {
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new Error(`Daemon HTTP ${res.status}: ${text}`);
			}
			if (!res.body) throw new Error('Daemon returned empty response body');

			const result = await readSSE(res.body, onProgress);
			if (result.ok) return result.output;
			throw new Error(result.message);
		});
	}

	private async healthCheck(): Promise<boolean> {
		try {
			const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
			return res.ok;
		} catch {
			return false;
		}
	}
}
