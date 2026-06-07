import { tryRocmSmi } from './RocmSmi.ts';
import type { GpuInfo } from './types.ts';
import { tryVulkanInfo } from './VulkanInfo.ts';

export const getGpuInfo = (): GpuInfo[] => {
	const gpus: GpuInfo[] = [];
	const sources: GpuInfo[][] = [];
	if (process.platform === 'linux') {
		const rocm = tryRocmSmi();
		if (rocm.length > 0) sources.push(rocm);
	}
	const vulkan = tryVulkanInfo();
	if (vulkan && vulkan.length > 0) sources.push(vulkan);

	console.log('GPU info sources:', JSON.stringify(sources, null, 2));
	const seen = new Set<string>();
	for (const source of sources) {
		for (const gpu of source) {
			const key = `${gpu.vendor}|${gpu.name}|${gpu.vram?.total ?? 'unknown'}`;
			if (!seen.has(key)) {
				seen.add(key);
				gpus.push(gpu);
			}
		}
	}
	return gpus;
};
