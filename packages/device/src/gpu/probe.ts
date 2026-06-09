import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import type { DeviceCache, GpuInfo } from './types.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const CACHE_FILE = join(REPO_ROOT, 'data', 'device-cache.json');

function pythonBin(): string {
	const isWin = process.platform === 'win32';
	return join(REPO_ROOT, '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
}

function readCache(): DeviceCache | null {
	try {
		if (!existsSync(CACHE_FILE)) return null;
		return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
	} catch {
		return null;
	}
}

function writeCache(cache: DeviceCache) {
	mkdirSync(join(REPO_ROOT, 'data'), { recursive: true });
	writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

/**
 * 检测缓存是否有效：所有 GPU 的 driverVersion 都没变。
 */
function cacheValid(cache: DeviceCache, gpus: GpuInfo[]): boolean {
	for (const gpu of gpus) {
		const key = `${gpu.vendor}|${gpu.name}`;
		const cached = cache.driverVersions[key];
		if (cached !== gpu.driverVersion) return false;
	}
	return true;
}

function probeTorchConv1d(pyBin: string): 'ok' | 'fail' {
	const result = spawnSync(pyBin, [
		'-c',
		[
			'import torch, torch.nn.functional as F, sys',
			'try:',
			'  x = torch.randn(1, 1, 64).cuda()',
			'  w = torch.randn(1, 1, 3).cuda()',
			'  F.conv1d(x, w).cpu()',
			'  print("ok")',
			'except:',
			'  print("fail")',
		].join('\n'),
	], {
		timeout: 10_000,
	});
	if (result.status !== 0) return 'fail';
	const out = (result.stdout?.toString() || '').trim();
	return out === 'ok' ? 'ok' : 'fail';
}

/**
 * 对首个支持 CUDA/ROCm 的 GPU 运行算子探测，结果缓存。
 * 驱动版本变化时自动重测。
 */
export function probeOps(gpus: GpuInfo[]): GpuInfo['opProbes'] | undefined {
	if (gpus.length === 0) return undefined;

	const hasCudaGpu = gpus.some((g) => g.capabilities.rocm || g.capabilities.cuda);
	if (!hasCudaGpu) return undefined;

	const cache = readCache();

	if (cache && cacheValid(cache, gpus)) {
		return cache.opProbes;
	}

	const pyBin = pythonBin();

	const torchConv1d = probeTorchConv1d(pyBin);

	const result: GpuInfo['opProbes'] = { torchConv1d };

	const newCache: DeviceCache = {
		driverVersions: Object.fromEntries(
			gpus.map((g) => [`${g.vendor}|${g.name}`, g.driverVersion]),
		),
		opProbes: result,
		updatedAt: new Date().toISOString(),
	};
	writeCache(newCache);

	return result;
}
