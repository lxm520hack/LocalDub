import { REPO_ROOT } from '@repo/config/path/root';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

function findRapidOCRModelsDir(): string {
	if (process.env.OCR_MODELS_DIR && existsSync(process.env.OCR_MODELS_DIR)) {
		return process.env.OCR_MODELS_DIR;
	}
	const venvBase = resolve(REPO_ROOT, '.venv');
	const modelsSub = join('rapidocr_onnxruntime', 'models');
	const candidates: string[] = [];
	if (process.platform === 'win32') {
		candidates.push(resolve(venvBase, 'Lib', 'site-packages', modelsSub));
	} else {
		const libDir = resolve(venvBase, 'lib');
		if (existsSync(libDir)) {
			const entries = readdirSync(libDir, { withFileTypes: true });
			const pyDirs = entries.filter(e =>
				e.isDirectory() && /^python\d+\.\d+$/.test(e.name)
			).map(e => e.name).sort().reverse();
			for (const pyDir of pyDirs) {
				candidates.push(resolve(libDir, pyDir, 'site-packages', modelsSub));
			}
			const sitePackagesLegacy = resolve(libDir, 'site-packages');
			if (existsSync(sitePackagesLegacy)) {
				const spEntries = readdirSync(sitePackagesLegacy, { withFileTypes: true });
				const spPyDirs = spEntries.filter(e =>
					e.isDirectory() && /^python\d+\.\d+$/.test(e.name)
				).map(e => e.name).sort().reverse();
				for (const pyDir of spPyDirs) {
					candidates.push(resolve(sitePackagesLegacy, pyDir, modelsSub));
				}
				candidates.push(resolve(sitePackagesLegacy, modelsSub));
			}
		}
	}
	for (const c of candidates) {
		if (existsSync(c)) return c;
	}
	throw new Error(
		`rapidocr models not found. Searched: ${candidates.join(', ')}\n` +
		`Hint: pip install rapidocr-onnxruntime in .venv, or set OCR_MODELS_DIR env var.`
	);
}

let _cached: string | undefined;

export function getRapidOCRModelsDir(): string {
	if (!_cached) _cached = findRapidOCRModelsDir();
	return _cached;
}
