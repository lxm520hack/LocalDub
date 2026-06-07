import type { Socket, TCPSocketListener } from 'bun';
import { MLDaemon } from './client.ts';
import { setActiveConn } from './active.ts';
import { readEnginesConfig } from '../../feat/config/engines.ts';
import { runPipeline } from '../../feat/tasks/pipeline-runner.ts';

export class DaemonServer {
  private port: number;
  private mlDaemon: MLDaemon;
  private idleTimeout: number;
  private lastActivity: number;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private server: TCPSocketListener<{ buffer: string }> | null = null;
  private queue: { conn: Socket<unknown>; taskId: string }[] = [];
  private busy = false;

  constructor(port: number, mlDaemon: MLDaemon, idleTimeout = 300) {
    this.port = port;
    this.mlDaemon = mlDaemon;
    this.idleTimeout = idleTimeout;
    this.lastActivity = Date.now();
  }

  async start(): Promise<void> {
    this.server = Bun.listen({
      hostname: '127.0.0.1',
      port: this.port,
      socket: {
        open: (conn) => {
          conn.data = { buffer: '' };
        },
        data: (conn, data) => {
          const buf = conn.data.buffer + new TextDecoder().decode(data as any);
          const lines = buf.split('\n');
          conn.data.buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let cmd: any;
            try { cmd = JSON.parse(trimmed); } catch { continue; }

            if (cmd.action === 'shutdown') {
              conn.end(JSON.stringify({ type: 'shutdown' }) + '\n');
              this.stop();
              return;
            }

            if (cmd.action === 'run_task' && cmd.task_id) {
              this.queue.push({ conn: conn as any, taskId: cmd.task_id });
              this._processQueue();
            }
          }
        },
        close: () => {},
      },
    });

    if (this.idleTimeout > 0) {
      this.idleTimer = setInterval(() => this._checkIdle(), 30_000);
    }

    console.log(
      `[DaemonServer] listening on 127.0.0.1:${this.port} (pid ${process.pid})` +
      (this.idleTimeout > 0 ? ` idle timeout=${this.idleTimeout}s` : ''),
    );
  }

  async stop(): Promise<void> {
    if (this.idleTimer) clearInterval(this.idleTimer);
    try { this.server?.stop(true); } catch {}
    process.exit(0);
  }

  private _checkIdle(): void {
    if (this.busy || this.queue.length > 0) return;
    const elapsed = (Date.now() - this.lastActivity) / 1000;
    if (elapsed >= this.idleTimeout) {
      console.log(`[DaemonServer] idle for ${elapsed.toFixed(0)}s, shutting down`);
      this.stop();
    }
  }

  private async _processQueue(): Promise<void> {
    if (this.busy || this.queue.length === 0) return;
    this.busy = true;

    const { conn, taskId } = this.queue.shift()!;
    setActiveConn(conn as any);

    try {
      await runPipeline(taskId, this.mlDaemon);
      try { conn.end(JSON.stringify({ type: 'complete', task_id: taskId }) + '\n'); } catch {}
    } catch (err: any) {
      try { conn.end(JSON.stringify({ type: 'error', task_id: taskId, message: err.message }) + '\n'); } catch {}
    } finally {
      setActiveConn(null);
      this.busy = false;
      this.lastActivity = Date.now();
      this._processQueue();
    }
  }
}
