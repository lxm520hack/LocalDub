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
		total?: number;
		used?: number;
		type?: 'dedicated' | 'shared' | 'unknown';
		reserved?: number;
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
}
