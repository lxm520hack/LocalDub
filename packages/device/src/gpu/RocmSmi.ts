import type { GpuInfo } from './types.ts';
import { run } from '../utils.ts';

const GFX_ARCH_MAP: Record<string, string> = {
	gfx1010: 'RDNA 1',
	gfx1011: 'RDNA 1',
	gfx1012: 'RDNA 1',
	gfx1030: 'RDNA 2',
	gfx1031: 'RDNA 2',
	gfx1032: 'RDNA 2',
	gfx1034: 'RDNA 2',
	gfx1035: 'RDNA 2',
	gfx1036: 'RDNA 2',
	gfx1100: 'RDNA 3',
	gfx1101: 'RDNA 3',
	gfx1102: 'RDNA 3',
	gfx1103: 'RDNA 3',
	gfx1150: 'RDNA 3.5',
	gfx1151: 'RDNA 3.5',
	gfx1200: 'RDNA 4',
	gfx1201: 'RDNA 4',
};
const APU_GFX_VERSIONS = new Set([
	'gfx909',
	'gfx1012',
	'gfx1031',
	'gfx1035',
	'gfx1036',
	'gfx1103',
	'gfx1150',
	'gfx1151',
]);

function getRocmVersionFromPackageManager(): string | null {
	const pacman = run('pacman -Q rocm-core 2>/dev/null');
	const pacmanMatch = pacman.match(/rocm-core\s+([\d.]+)/);
	if (pacmanMatch) return pacmanMatch[1];

	const dpkg = run('dpkg -l rocm-core 2>/dev/null');
	const dpkgMatch = dpkg.match(/rocm-core\s+\S+\s+([\d.]+)/);
	if (dpkgMatch) return dpkgMatch[1];

	const rpm = run('rpm -q rocm-core 2>/dev/null');
	const rpmMatch = rpm.match(/rocm-core-([\d.]+)/);
	if (rpmMatch) return rpmMatch[1];

	const zypper = run('zypper info rocm-core 2>/dev/null');
	const zypperMatch = zypper.match(/Version\s*:\s*([\d.]+)/);
	if (zypperMatch) return zypperMatch[1];

	return null;
}

export const tryRocmSmi = () => {
	const gpus: GpuInfo[] = [];
	const capabilities = {
		cuda: false,
		rocm: true,
		mps: false,
		webgpu: true,
		vulkan: true,
		directml: false,
		openvino: false,
	};
	const smi = run('rocm-smi 2>/dev/null');
	if (!smi) {
		return gpus;
	}

	const driverVer = getRocmVersionFromPackageManager() || 'unknown';

	for (const line of smi.split('\n')) {
		if (!/^\d+\s+/.test(line)) continue;

		const tempM = line.match(/([\d.]+)°C/);
		const pctMatches = [...line.matchAll(/(\d+)%/g)];
		const parts = line.trim().split(/\s+/);

		const id = parts[0];
		const temp = tempM ? parseFloat(tempM[1]) : 0;
		const vramPct =
			pctMatches.length >= 2
				? parseInt(pctMatches[pctMatches.length - 2][1])
				: 0;
		const gpuPct =
			pctMatches.length >= 1
				? parseInt(pctMatches[pctMatches.length - 1][1])
				: 0;

		let gpuName = `GPU ${id}`;
		let gfxVer = '';
		const pn = run('rocm-smi --showproductname 2>/dev/null');
		const pm = pn.match(
			new RegExp(`GPU\\[${id}\\]\\s*:\\s*Card Series:\\s*(.+)`, 'i'),
		);
		if (pm) gpuName = pm[1].trim();
		const gfxM = pn.match(/GFX Version:\s*(.+)/i);
		if (gfxM) gfxVer = gfxM[1].trim();

		gpus.push({
			name: gpuName,
			architecture: GFX_ARCH_MAP[gfxVer] ?? undefined,
			driverVersion: driverVer,
			temperature: temp,
			vram: {
				percent: vramPct,
			},
			gpuPercent: gpuPct,
			gfxVersion: gfxVer,
			hsaOverrideGfx: process.env.HSA_OVERRIDE_GFX_VERSION,
			vendor: 'amd',
			capabilities,
		});
	}

	if (gpus.length === 0) {
		const fallbackPn = run('rocm-smi --showproductname 2>/dev/null');
		const fallbackM = fallbackPn.match(/Card Series:\s*(.+)/i);
		gpus.push({
			name: fallbackM?.[1]?.trim() ?? 'Unknown',
			architecture: undefined,
			driverVersion: driverVer,
			temperature: 0,
			vram: {
				percent: 0,
			},
			gpuPercent: 0,
			vendor: 'amd',
			capabilities,
		});
	}

	return gpus;
};
