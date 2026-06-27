import { pythonBin, REPO_ROOT } from "@repo/config";
import { InputArgs } from "../config/config";
import { startTorchServer, stopTorchServer } from "../../ml/server/client";
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { startVoxCPMTorchGradioServer, stopVoxCPMTorchGradioServer, voxcpmTorchGradioStatus } from "../../ml/voxcpm/runtime/VoxCPMPyTTorchGradio";
import { torchStatus } from "../../ml/server/torchServer";



export const cmdServers = async (input: InputArgs) => {
  const action = input.servers?.action ?? 'status';
		const name = input.servers?.name;
		const TORCH_PORT = 19109;
		const voxcpmTorchGradioPort = 19112;




		if (action === 'stop') {
			if (!name || name === 'torch') {
				await stopTorchServer(`http://127.0.0.1:${TORCH_PORT}`);
				console.log('[Servers] Torch server stopped');
			}
			if (!name || name === 'voxcpm_torch_gradio') {
			await	stopVoxCPMTorchGradioServer({ port: voxcpmTorchGradioPort });
			}
		} else if (action === 'start') {
			if (!name || name === 'torch') {
        await startTorchServer(TORCH_PORT);
        console.log(`[Servers] Torch server ready on port ${TORCH_PORT}`);
			}
			if (!name || name === 'voxcpm_torch_gradio') {
        const { url } = await startVoxCPMTorchGradioServer({port: voxcpmTorchGradioPort, waitForReady: true});
        console.log(`[Servers] VoxCPM Gradio server ready at ${url}`);
			}
		} else {
			const result: Record<string, unknown> = {};
			if (!name || name === 'torch') result.torch = await torchStatus(TORCH_PORT);
			if (!name || name === 'voxcpm_torch_gradio') result.voxcpm_torch_gradio = await voxcpmTorchGradioStatus({ port: voxcpmTorchGradioPort });
			console.log(JSON.stringify(result, null, 2));
		}
}