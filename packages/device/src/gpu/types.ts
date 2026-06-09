export interface GpuInfo {
	name: string;
	vendor: 'amd' | 'nvidia' | 'intel' | 'unknown';
	architecture?: string;
	driverVersion: string;
	temperature: number;
	gpuPercent: number;
	gfxVersion?: string;

	vram: {
		percent: number;
		/**
		 * GPU 可直接访问的专用显存（GB）。
		 * - 独显：本地 GDDR 容量
		 * - APU (iGPU)：UEFI/BIOS 中设定的预留 carveout 大小（可配置，如 512MB~16GB）
		 * - Vulkan 的 DEVICE_LOCAL heap 在 APU 上可能比 carveout 大，
		 *   因为驱动会把部分 GTT 也标记为 DEVICE_LOCAL（"visible VRAM"）
		 */
		total?: number;
		used?: number;
		type?: 'dedicated' | 'shared' | 'unknown';
		reserved?: number;
		/**
		 * GTT (Graphics Translation Table) 可映射的系统内存（GB）。
		 * APU iGPU 没有独立显存芯片，通过 GTT 页表访问系统内存。
		 * rocm-smi `GTT Total Memory` 字段。
		 * vram.total + gtt = GPU 可访问的总内存上限。
		 */
		gtt?: number;
	};
	capabilities: {
		webgpu: boolean;
		vulkan: boolean;
		cuda: boolean;
		rocm: boolean;
		directml: boolean;
		mps: boolean;
		openvino: boolean;
	};
	hsaOverrideGfx?: string;
	/**
	 * Vulkan memory heap 视角（GB）。
	 * APU 上 heap 划分与 ROCm 不同：
	 *   deviceLocal = VRAM carveout + 一部分 GTT（驱动合并标记为 DEVICE_LOCAL）
	 *   hostVisible = 剩余 GTT 内存
	 * 两者之和 = vram.total + vram.gtt = GPU 可访问总内存。
	 * 独显上 deviceLocal = GDDR 总量，hostVisible = 0。
	 */
	vulkanHeaps?: {
		deviceLocal: number;
		hostVisible: number;
	};
	/**
	 * 算子级可用性探测结果。
	 * 实际执行最小推理测试来验证 GPU 能否跑特定算子，
	 * 而非仅依赖驱动版本声明（如 ROCm 驱动存在但 conv1d 可能 segfault）。
	 * 结果按 driverVersion 缓存到 data/device-cache.json，驱动版本变化时自动重测。
	 */
	opProbes?: {
		torchConv1d?: 'ok' | 'fail';
	};
}

/** data/device-cache.json 的结构 */
export interface DeviceCache {
	driverVersions: Record<string, string>;
	opProbes: NonNullable<GpuInfo['opProbes']>;
	updatedAt: string;
}
