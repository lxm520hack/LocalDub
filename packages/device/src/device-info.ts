import { execSync } from 'node:child_process';
import * as os from 'node:os';
import * as ort from 'onnxruntime-node';
import { getGpuInfo } from './gpu/gpu.ts';
import type { GpuInfo } from './gpu/types.ts';
import { fmtBytes } from './utils.ts';

export interface OrtBackend {
	name: string;
	bundled: boolean;
}

export interface DeviceInfo {
	platform: {
		os: string;
		arch: string;
		release: string;
		hostname: string;
		runtime: string;
		runtimeVersion: string;
	};
	cpu: {
		model: string;
		cores: number;
		speedMHz: number;
	};
	memory: {
		total: string;
		free: string;
		processHeapUsed: string;
	};
	gpu: GpuInfo[];
	ort: {
		version: string;
		backends: OrtBackend[];
	};
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
	const cpus = os.cpus();
	const backends: OrtBackend[] = (ort.listSupportedBackends?.() ?? []).map(
		(b) => ({
			name: b.name,
			bundled: b.bundled,
		}),
	);

	return {
		platform: {
			os: process.platform,
			arch: process.arch,
			release: os.release(),
			hostname: os.hostname(),
			runtime: 'bun',
			runtimeVersion: process.version,
		},
		cpu: {
			model: cpus[0]?.model ?? 'unknown',
			cores: cpus.length,
			speedMHz: cpus[0]?.speed ?? 0,
		},
		memory: {
			total: fmtBytes(os.totalmem()),
			free: fmtBytes(os.freemem()),
			processHeapUsed: fmtBytes(process.memoryUsage().heapUsed),
		},
		gpu: getGpuInfo(),
		ort: {
			version: ort.env.versions?.common ?? 'unknown',
			backends,
		},
	};
}
