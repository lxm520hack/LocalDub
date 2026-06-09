import type { GpuInfo } from './types.ts';
import { bytesToGB, run } from '../utils.ts';

export function tryVulkanInfo(): GpuInfo[] {
	const gpus: GpuInfo[] = [];

	const jsonOutput = run('vulkaninfo --json 2>/dev/null', 5000);
	if (jsonOutput) {
		try {
			const data = JSON.parse(jsonOutput);
			const devices = data?.VkPhysicalDevices || [];

			for (const dev of devices) {
				const props = dev?.VkPhysicalDeviceProperties || {};
				const mem = dev?.VkPhysicalDeviceMemoryProperties || {};

				/*
				 * APU (iGPU) 上的 Vulkan memory heaps:
				 *   Heap X (DEVICE_LOCAL)     → VRAM carveout + 部分 GTT
				 *   Heap Y (HOST_VISIBLE only) → 剩余 GTT 系统内存
				 * 两个 heap size 之和 = GPU 可访问总内存上限。
				 *
				 * 独显 dGPU 通常只有 1 个 DEVICE_LOCAL heap = GDDR 容量。
				 */
				let deviceLocalGB = 0;
				let hostVisibleGB = 0;
				const heaps = mem?.memoryHeaps || [];
				for (const heap of heaps) {
					const sizeGB = bytesToGB(heap.size);
					if (heap?.flags?.deviceLocal) {
						deviceLocalGB = Math.max(deviceLocalGB, sizeGB);
					} else if (heap?.flags?.hostVisible) {
						hostVisibleGB = Math.max(hostVisibleGB, sizeGB);
					}
				}
				const vramTotalGB = deviceLocalGB || 0;

				const vendorId = props?.vendorID;
				let vendor: 'amd' | 'nvidia' | 'intel' | 'unknown' = 'unknown';
				if (vendorId === 0x10de) vendor = 'nvidia';
				else if (vendorId === 0x1002 || vendorId === 0x1022) vendor = 'amd';
				else if (vendorId === 0x8086) vendor = 'intel';

				/*
				 * APU 检测：AMD/Intel GPU 有 2 个 memory heap
				 * (一个 DEVICE_LOCAL + 一个 HOST_VISIBLE) → 集成显卡。
				 * 独显通常只有 1 个 DEVICE_LOCAL heap。
				 */
				const isIntegrated = hostVisibleGB > 0 && deviceLocalGB > 0;
				const gttGB = hostVisibleGB || undefined;
				gpus.push({
					name: props?.deviceName || 'Unknown Vulkan GPU',
					architecture: undefined,
					driverVersion: props?.driverVersion?.toString() || '',
					temperature: 0,
					gpuPercent: 0,
					vram: {
						percent: 0,
						total: vramTotalGB,
						used: 0,
						type: isIntegrated ? 'shared' : 'dedicated',
						gtt: gttGB,
					},
					vulkanHeaps: (deviceLocalGB || hostVisibleGB) ? {
						deviceLocal: deviceLocalGB,
						hostVisible: hostVisibleGB,
					} : undefined,
					vendor,
					capabilities: {
						webgpu: true,
						vulkan: true,
						cuda: vendor === 'nvidia',
						rocm: vendor === 'amd' && process.platform === 'linux',
						directml: false,
						mps: false,
						openvino: vendor === 'intel',
					},
				});
			}

			if (gpus.length > 0) return gpus;
		} catch {
		}
	}

	/*
	 * 解析 vulkaninfo 文本输出。
	 * 各 GPU 的 Properties 和 MemoryProperties 节分散在数千行输出中，
	 * 用正则按 GPU 序号（GPU id = N）关联。
	 */
	const textOutput = run('vulkaninfo 2>/dev/null', 10000);
	if (textOutput) {
		// 按 "VkPhysicalDeviceProperties:" 分割，每个设备一段
		const deviceSections = textOutput.split('VkPhysicalDeviceProperties:');
		// 第一段是 header + layers，跳过
		for (let i = 1; i < deviceSections.length; i++) {
			const section = deviceSections[i];
			const j = deviceSections.length > i + 1
				? textOutput.indexOf('VkPhysicalDeviceProperties:', textOutput.indexOf(section) + 1)
				: textOutput.length;
			// 从当前 Properties 到下一个 Properties 之间的完整区域
			const fullBlock = textOutput.slice(textOutput.indexOf(section), j);

			const nameM = section.match(/deviceName\s*=\s*(.+)/);
			if (!nameM) continue;
			const name = nameM[1].trim();

			const vendorM = fullBlock.match(/vendorID\s*=\s*(0x[0-9a-fA-F]+)/);
			const vendorId = vendorM ? parseInt(vendorM[1], 16) : 0;
			let vendor: 'amd' | 'nvidia' | 'intel' | 'unknown' = 'unknown';
			if (vendorId === 0x10de) vendor = 'nvidia';
			else if (vendorId === 0x1002 || vendorId === 0x1022) vendor = 'amd';
			else if (vendorId === 0x8086) vendor = 'intel';

			// 解析该设备的 memory heaps
			// VkPhysicalDeviceMemoryProperties 在 Properties 之后出现，包含 memoryHeaps 段
			let deviceLocalGB = 0;
			let hostVisibleGB = 0;
			const memStart = fullBlock.indexOf('VkPhysicalDeviceMemoryProperties:');
			if (memStart >= 0) {
				const memBlock = fullBlock.slice(memStart);
				const heapMatches = [...memBlock.matchAll(/memoryHeaps\[(\d+)\]:\s*size\s*=\s*(\d+)/g)];
				const heapSizes = new Map<number, number>();
				for (const m of heapMatches) heapSizes.set(parseInt(m[1]), parseInt(m[2]));
				for (const [idx, sizeBytes] of heapSizes) {
					// 找这个 heap 后面的 flags 区
					const heapPattern = new RegExp(`memoryHeaps\\[${idx}\\]:[\\s\\S]*?(?=memoryHeaps\\[|$)`);
					const heapBlock = memBlock.match(heapPattern);
					const isDeviceLocal = heapBlock?.[0]?.includes('MEMORY_HEAP_DEVICE_LOCAL_BIT') ?? false;
					const sizeGB = sizeBytes / 1024 ** 3;
					if (isDeviceLocal) {
						deviceLocalGB = Math.max(deviceLocalGB, sizeGB);
					} else {
						hostVisibleGB = Math.max(hostVisibleGB, sizeGB);
					}
				}
			}

			const isIntegrated = hostVisibleGB > 0 && deviceLocalGB > 0;
			gpus.push({
				name,
				architecture: undefined,
				driverVersion: '',
				temperature: 0,
				gpuPercent: 0,
				vram: {
					percent: 0,
					total: deviceLocalGB || undefined,
					used: 0,
					type: isIntegrated ? 'shared' : (deviceLocalGB > 0 ? 'dedicated' : 'unknown'),
				},
				vulkanHeaps: (deviceLocalGB || hostVisibleGB) ? {
					deviceLocal: deviceLocalGB,
					hostVisible: hostVisibleGB,
				} : undefined,
				vendor,
				capabilities: {
					webgpu: true,
					vulkan: true,
					cuda: vendor === 'nvidia',
					rocm: vendor === 'amd' && process.platform === 'linux',
					directml: false,
					mps: false,
					openvino: vendor === 'intel',
				},
			});
		}

		if (gpus.length > 0) return gpus;
	}

	return [];
}
