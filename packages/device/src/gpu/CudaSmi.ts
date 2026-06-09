import type { GpuInfo } from './types.ts';
import { bytesToGB, run } from '../utils.ts';

export function tryCudaSmi(): GpuInfo[] {
	const gpus: GpuInfo[] = [];

	const out = run(
		'nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.total,memory.used --format=csv,noheader,nounits 2>/dev/null',
		5000,
	);
	if (!out) return gpus;

	const lines = out.split('\n').filter(Boolean);
	for (const line of lines) {
		const parts = line.split(', ').map((s) => s.trim());
		if (parts.length < 5) continue;

		const name = parts[0];
		const temp = parseInt(parts[1]) || 0;
		const gpuPct = parseInt(parts[2]) || 0;
		const memTotalMiB = parseInt(parts[3]) || 0;
		const memUsedMiB = parseInt(parts[4]) || 0;

		// nvidia-smi returns memory in MiB, convert to GB
		const vramTotalGB = memTotalMiB / 1024;
		const vramUsedGB = memUsedMiB / 1024;
		const vramPct = memTotalMiB > 0 ? Math.round((memUsedMiB / memTotalMiB) * 100) : 0;

		gpus.push({
			name,
			architecture: undefined,
			driverVersion: '',
			temperature: temp,
			gpuPercent: gpuPct,
			vram: {
				percent: vramPct,
				total: vramTotalGB,
				used: vramUsedGB,
				type: 'dedicated',
			},
			vendor: 'nvidia',
			capabilities: {
				cuda: true,
				rocm: false,
				mps: false,
				webgpu: true,
				vulkan: true,
				directml: false,
				openvino: false,
			},
		});
	}

	return gpus;
}
