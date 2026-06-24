import * as ort from 'onnxruntime-node';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { Transformer, ResizeFit } from '@napi-rs/image';
// @ts-ignore - no types published
import { PNG } from 'pngjs';
import { REPO_ROOT } from '@repo/config';

/**
 * Dynamically locate rapidocr model directory.
 */
export function findRapidOcrModelsDir(): string {
	const venvBase = resolve(REPO_ROOT, '.venv');
	const libDir = resolve(venvBase, process.platform === 'win32' ? 'Lib' : 'lib');
	let spDir: string;
	if (process.platform === 'win32') {
		spDir = join(libDir, 'site-packages');
	} else {
		// Linux/macOS: lib/pythonX.Y/site-packages
		const entries = existsSync(libDir) ? readdirSync(libDir, { withFileTypes: true }) : [];
		const pyDir = entries.find(e => e.isDirectory() && e.name.startsWith('python'));
		spDir = pyDir ? join(libDir, pyDir.name, 'site-packages') : join(libDir, 'site-packages');
	}
	if (!existsSync(spDir)) {
		throw new Error(`site-packages not found: ${spDir}`);
	}
	const modelsDir = join(spDir, 'rapidocr_onnxruntime', 'models');
	if (!existsSync(modelsDir)) {
		throw new Error(`rapidocr models not found: ${modelsDir}`);
	}
	return modelsDir;
}
