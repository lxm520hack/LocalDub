import { pythonBin } from "@repo/config";
import { join } from 'node:path';
import { REPO_ROOT } from '@repo/config';
import type { ModelServerStatus } from "../../server/type";
import { spawn, type ChildProcess } from 'node:child_process';

export const voxcpmTorchGradioStatus = async ({
  port,
}: {
  port: number;
}): Promise<ModelServerStatus> => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(2000),
    });
    return await res.json() as ModelServerStatus;
  } catch {
    return { status: 'stopped', port, message: 'Not running', models: { voxcpm: { status: 'unloaded' } } };
  }
}

export const startVoxCPMTorchGradioServer = async ({
  port,
  device = 'cpu',
  modelDir = join(REPO_ROOT, 'data', 'modelscope', 'OpenBMB__VoxCPM2'),
  waitForReady = false,
}: {
  port: number;
  device?: string;
  modelDir?: string;
  /** When true, waits for "[VoxCPM] Ready" on stdout before resolving */
  waitForReady?: boolean;
}): Promise<{
  url: string;
  proc?: ChildProcess;
}> => {
  const mainPath = join(REPO_ROOT, 'packages', 'voxcpm_torch_server', 'server.py');
  const url = `http://127.0.0.1:${port}`;

  const proc = spawn(pythonBin(), [mainPath, '--port', String(port), '--device', device, '--model-dir', modelDir], {
    env: { ...process.env as Record<string, string> },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (waitForReady) {
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 120_000;
      proc.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('[VoxCPM] Ready')) resolve();
      });
      proc.stderr?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('[VoxCPM] Ready')) resolve();
      });
      proc.on('error', reject);
      proc.on('exit', (code) => reject(new Error(`VoxCPM Gradio exited ${code}`)));
      setTimeout(() => reject(new Error('VoxCPM Gradio startup timeout')), deadline - Date.now());
    });
  }

  return { url, proc };
}

export const stopVoxCPMTorchGradioServer = async ({port}:{port: number}): Promise<void> => {
  await fetch(`http://127.0.0.1:${port}/shutdown`, {
    method: 'POST', signal: AbortSignal.timeout(2000),
  }).catch((err) => {
    console.error('[servers] VoxCPM PyTorch Gradio server shutdown request failed:', err);
  });
  console.log('[servers] VoxCPM PyTorch Gradio server stopped');
}

export const loadVoxCPMTorchGradioModel = async (baseUrl: string, device: string): Promise<void> => {
  const res = await fetch(`${baseUrl}/load-model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device }),
  });
  if (!res.ok) throw new Error(`load-model failed: ${res.status}`);
}

export const connectToVoxCPMTorchGradioServer = async ({baseUrl, device='cpu'}:{baseUrl: string, device: string}) => {
  const port = Number(new URL(baseUrl).port);
  const res = await voxcpmTorchGradioStatus({ port })
  
  if (res.status === 'running') {
    if (res.models.voxcpm.status === 'ready') {
      return {url: baseUrl, proc: undefined};
    } else if (res.models.voxcpm.status === 'unloaded') {
      await loadVoxCPMTorchGradioModel(baseUrl, device);
      return {url: baseUrl, proc: undefined};
    } else if (res.models.voxcpm.status === 'loading') {}
    else if (res.models.voxcpm.status === 'error') {}
  } else if (res.status === 'stopped') {
    // Spawn Gradio server and wait for URL
    const ret = await startVoxCPMTorchGradioServer({ port, device, waitForReady: true });
    			// Load model via dedicated endpoint
			await loadVoxCPMTorchGradioModel(ret.url, device);
    return ret;
  } else if (res.status === 'error') {}
}