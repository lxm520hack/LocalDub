import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { REPO_ROOT, pythonBin, delimiter } from '../../feat/config/engines.ts';

type ProgressCallback = (current: number, total: number) => void;

interface PendingRequest {
  resolve: (output: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  onProgress?: ProgressCallback;
}

export class MLDaemon {
  private proc: ChildProcess | null = null;
  private reader: ReturnType<typeof createInterface> | null = null;
  private pending = new Map<string, PendingRequest>();
  private _ready = false;

  get ready() {
    return this._ready;
  }

  get pid(): number | null {
    return this.proc?.pid ?? null;
  }

  get exited(): boolean {
    return this.proc?.exitCode != null;
  }

  async start(timeoutMs = 30000): Promise<void> {
    const pyBin = pythonBin();
    const scriptPath = join(REPO_ROOT, 'packages', 'cli', 'scripts', 'pipeline_daemon.py');
    const voxcpmSrc = join(REPO_ROOT, 'submodule', 'VoxCPM', 'src');

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    const existing = env.PYTHONPATH || '';
    env.PYTHONPATH = existing ? `${voxcpmSrc}${delimiter}${existing}` : voxcpmSrc;

    this.proc = spawn(pyBin, [scriptPath], { env, stdio: ['pipe', 'pipe', 'pipe'] });

    this.proc.on('exit', (code) => {
      this._ready = false;
      for (const [, p] of this.pending) p.reject(new Error(`Daemon exited with code ${code}`));
      this.pending.clear();
    });

    this.reader = createInterface({ input: this.proc.stdout! });
    this.reader.on('line', (line: string) => this._handleMessage(line));

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Daemon startup timeout')), timeoutMs);
      this.pending.set('__startup__', {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    this.proc.stdin!.write(JSON.stringify({ action: 'shutdown' }) + '\n');
    return new Promise((resolve) => {
      this.proc!.on('exit', () => resolve());
      setTimeout(() => { this.proc!.kill(); resolve(); }, 2000);
    });
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
      this.proc!.stdin!.write(
        JSON.stringify({ action: 'run_stage', stage, task_id: taskId, params }) + '\n',
      );
    });
  }

  private _handleMessage(line: string) {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }

    if (msg.type === 'ready') {
      const p = this.pending.get('__startup__');
      if (p) { p.resolve({}); this.pending.delete('__startup__'); }
      this._ready = true;
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
      if (p) { p.resolve(msg.output || {}); this.pending.delete(key); }
      return;
    }

    if (msg.type === 'error') {
      const key = `${msg.task_id}_${msg.stage}`;
      const p = this.pending.get(key);
      if (p) { p.reject(new Error(msg.message)); this.pending.delete(key); }
      return;
    }
  }
}
