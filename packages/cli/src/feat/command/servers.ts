import { pythonBin, REPO_ROOT } from "@repo/config";
import { InputArgs } from "../input/input";
import { startTorchServer, stopTorchServer } from "../../ml/server/client";
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { startVoxCPMTorchGradioServer, stopVoxCPMTorchGradioServer, voxcpmTorchGradioStatus } from "../../ml/voxcpm/runtime/VoxCPMPyTTorchGradio";
import { torchStatus } from "../../ml/server/torchServer";
import { findServer } from '@repo/config/discovery';

export const cmdServers = async (input: InputArgs) => {
  const action = input.servers?.action ?? 'status';
  const name = input.servers?.name;

  if (action === 'stop') {
    if (!name || name === 'torch') {
      const { port } = await findServer('torch');
      await stopTorchServer(`http://127.0.0.1:${port}`);
      console.log(`[Servers] Torch server (port ${port}) stopped`);
    }
    if (!name || name === 'voxcpm_torch_gradio') {
      const { port } = await findServer('voxcpm_torch_gradio');
      await stopVoxCPMTorchGradioServer({ port });
    }
  } else if (action === 'start') {
    if (!name || name === 'torch') {
      const url = await startTorchServer();
      console.log(`[Servers] PyTorch server ready at ${url}`);
    }
    if (!name || name === 'voxcpm_torch_gradio') {
      const { port } = await findServer('voxcpm_torch_gradio');
      const { url } = await startVoxCPMTorchGradioServer({ port, waitForReady: true });
      console.log(`[Servers] VoxCPM PyTorch Gradio server ready at ${url}`);
    }
  } else if (action === 'status') {
    const result: Record<string, unknown> = {};
    if (!name || name === 'torch') {
      const { port } = await findServer('torch');
      result.torch = await torchStatus(port);
    }
    if (!name || name === 'voxcpm_torch_gradio') {
      const { port } = await findServer('voxcpm');
      result.voxcpm_torch_gradio = await voxcpmTorchGradioStatus({ port });
    }
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(`[Servers] Unknown action: ${action}`);
  }
}