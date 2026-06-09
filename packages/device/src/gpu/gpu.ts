import { tryRocmSmi } from './RocmSmi.ts';
import { tryCudaSmi } from './CudaSmi.ts';
import type { GpuInfo } from './types.ts';
import { tryVulkanInfo } from './VulkanInfo.ts';

export const getGpuInfo = (): GpuInfo[] => {
	const gpus: GpuInfo[] = [];
	const sources: GpuInfo[][] = [];
	if (process.platform === 'linux') {
		const rocm = tryRocmSmi();
		if (rocm.length > 0) sources.push(rocm);
	}
	const cuda = tryCudaSmi();
	if (cuda.length > 0) sources.push(cuda);
	const vulkan = tryVulkanInfo();
	if (vulkan && vulkan.length > 0) sources.push(vulkan);

	// 合并多来源信息：按 vendor|基础名称 去重
	// 基础名称消除 Vulkan 后缀差异（"(RADV PHOENIX)" vs 无后缀）
	const seen = new Map<string, GpuInfo>();
	const normName = (n: string) =>
		n.replace(/\s*\([A-Z]+ .*\)$/, '').trim();
	for (const source of sources) {
		for (const gpu of source) {
			const key = `${gpu.vendor}|${normName(gpu.name)}`;
			const existing = seen.get(key);
			if (existing) {
				// 补充不同来源的字段
				// vulkanHeaps 来自 Vulkan 检测
				if (gpu.vulkanHeaps && !existing.vulkanHeaps) {
					existing.vulkanHeaps = gpu.vulkanHeaps;
				}
				// vram.total 优先取 nvidia-smi / rocm-smi 的精确值
				if (gpu.vram.total != null && existing.vram.total == null) {
					existing.vram.total = gpu.vram.total;
				}
				// temperature / gpuPercent 优先取 nvidia-smi / rocm-smi 的实时值
				if (gpu.temperature > 0 && existing.temperature === 0) {
					existing.temperature = gpu.temperature;
				}
				if (gpu.gpuPercent > 0 && existing.gpuPercent === 0) {
					existing.gpuPercent = gpu.gpuPercent;
				}
				if (gpu.vram.percent > 0 && existing.vram.percent === 0) {
					existing.vram.percent = gpu.vram.percent;
				}
				if (gpu.vram.used != null && existing.vram.used == null) {
					existing.vram.used = gpu.vram.used;
				}
				if (gpu.vram.type !== 'unknown' && (existing.vram.type === 'unknown' || existing.vram.type == null)) {
					existing.vram.type = gpu.vram.type;
				}
			} else {
				seen.set(key, gpu);
			}
		}
	}
	return [...seen.values()];
};
