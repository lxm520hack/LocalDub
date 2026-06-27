import { pythonBin } from "@repo/config";
import type { ModelServerStatus } from "../../server/type";
import { spawn } from 'node:child_process';

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

export const startVoxCPMTorchGradioServer = async ({port, mainPath, modelDir}:{port: number,
  mainPath: string,
  modelDir: string,
}): Promise<void> => {
  const proc = spawn(pythonBin(), [mainPath, '--port', String(port), '--device', 'cpu', '--model-dir', modelDir], {
    env: { ...process.env as Record<string, string> },
    detached: true, stdio: 'inherit',
  });
  proc.unref();
  console.log(`[Servers] VoxCPM Gradio server started (pid ${proc.pid})`);
}

export const stopVoxCPMTorchGradioServer = async ({port}:{port: number}): Promise<void> => {
  await fetch(`http://127.0.0.1:${port}/shutdown`, {
    method: 'POST', signal: AbortSignal.timeout(2000),
  }).catch(() => {});
  console.log('[servers] VoxCPM PyTorch Gradio server stopped');
}