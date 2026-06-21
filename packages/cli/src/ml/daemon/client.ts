import { type ChildProcess, spawn } from 'node:child_process';
import { type Socket, connect } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { delimiter, pythonBin, REPO_ROOT } from '../../feat/config/config.ts';

const DAEMON_PORT_DEFAULT = 19109;

type ProgressCallback = (current: number, total: number) => void;

interface PendingRequest {
	resolve: (output: Record<string, unknown>) => void;
	reject: (err: Error) => void;
	onProgress?: ProgressCallback;
}

export function connectToDaemon(port: number): Promise<Socket | null> {
	return new Promise((resolve) => {
		try {
			const conn = connect({ host: '127.0.0.1', port }, () => resolve(conn));
			conn.on('error', () => resolve(null));
		} catch {
			resolve(null);
		}
	});
}

export class MLDaemon {
	private conn: Socket | null = null;
	private proc: ChildProcess | null = null;
	private reader: ReturnType<typeof createInterface> | null = null;
	private pending = new Map<string, PendingRequest>();
	private _ready = false;

	constructor(private port: number = DAEMON_PORT_DEFAULT) {}

	get ready() {
		return this._ready;
	}

	get pid(): number | null {
		return this.proc?.pid ?? this.conn?.remoteAddress ? -1 : null;
	}

	async start(timeoutMs = 60000): Promise<void> {
		if (this._ready) return;
		// 1) Try existing daemon via TCP
		const sock = await connectToDaemon(this.port);
		if (sock) {
			this.conn = sock;
			this._setupTCP(sock);
			this._ready = true;
			console.log(`[Daemon] Connected to existing daemon on 127.0.0.1:${this.port}`);
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
		};
		const existing = env.PYTHONPATH || '';
		env.PYTHONPATH = existing
			? `${voxcpmSrc}${delimiter}${existing}`
			: voxcpmSrc;

		this.proc = spawn(pyBin, [scriptPath, '--port', String(this.port)], {
			env,
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		this.proc.stderr?.pipe(process.stderr);
		this.proc.unref();

		// 3) Wait for TCP ready
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 200));
			const s = await connectToDaemon(this.port);
			if (s) {
				this.conn = s;
				this._setupTCP(s);
				this._ready = true;
				console.log(`[Daemon] Daemon ready on 127.0.0.1:${this.port} (pid ${this.proc.pid})`);
				return;
			}
		}

		throw new Error(`Daemon startup timeout after ${timeoutMs}ms`);
	}

	async stop(): Promise<void> {
		this.reader?.close();
		this.reader = null;
		if (this.conn) {
			if (this.proc && !this.conn.destroyed) {
				try {
					this.conn.write(JSON.stringify({ action: 'shutdown' }) + '\n');
				} catch { /* socket already closed */ }
			}
			if (!this.conn.destroyed) this.conn.end();
			this.conn = null;
		}
		if (this.proc) {
			this.proc.stdout?.destroy();
			this.proc.stderr?.destroy();
		}
		this._ready = false;
	}

	runStage(
		stage: string,
		taskId: string,
		params: Record<string, unknown>,
		onProgress?: ProgressCallback,
	): Promise<Record<string, unknown>> {
		return new Promise((resolve, reject) => {
			const key = `${taskId}_${stage}`;
			this.pending.set(key, { resolve, reject, onProgress });
			this.conn!.write(
				JSON.stringify({
					action: 'run_stage',
					stage,
					task_id: taskId,
					params,
				}) + '\n',
			);
		});
	}

	private _setupTCP(sock: Socket) {
		this.reader = createInterface({ input: sock });
		this.reader.on('line', (line: string) => this._handleMessage(line));
		sock.on('error', (err) => {
			console.error(`[Daemon] Socket error: ${err.message}`);
		});
		sock.on('close', () => {
			this._ready = false;
			for (const [, p] of this.pending)
				p.reject(new Error('Daemon connection closed'));
			this.pending.clear();
		});
	}

	private _handleMessage(line: string) {
		let msg: any;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}

		if (msg.type === 'progress') {
			const key = `${msg.task_id}_${msg.stage}`;
			const p = this.pending.get(key);
			if (p?.onProgress && msg.current != null && msg.total != null) {
				p.onProgress(msg.current, msg.total);
			}
			return;
		}

		if (msg.type === 'complete') {
			const key = `${msg.task_id}_${msg.stage}`;
			const p = this.pending.get(key);
			if (p) {
				p.resolve(msg.output || {});
				this.pending.delete(key);
			}
			return;
		}

		if (msg.type === 'error') {
			const key = `${msg.task_id}_${msg.stage}`;
			const p = this.pending.get(key);
			if (p) {
				p.reject(new Error(msg.message));
				this.pending.delete(key);
			}
			return;
		}
	}
}
