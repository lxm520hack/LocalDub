import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { REPO_ROOT } from '../../../feat/config/config.ts';

export interface OCRLine {
	text: string;
	confidence: number;
	box: number[][];
}

const BUILD_DIR = resolve(REPO_ROOT, 'packages', 'subtitle-ocr', 'subtitle-opencv-cpp', 'build');
const OCR_KEYS_PATH = resolve(REPO_ROOT, 'packages', 'subtitle-ocr', 'ppocr_keys.json');
const LIB_PATH_KEY = process.platform === 'win32' ? 'PATH' : 'LD_LIBRARY_PATH';

function findRapidOCRModelsDir(): string {
	const venvBase = resolve(REPO_ROOT, '.venv');
	const sitePackagesBase = resolve(venvBase, process.platform === 'win32' ? 'Lib' : 'lib', 'site-packages');
	if (!existsSync(sitePackagesBase)) {
		throw new Error(`site-packages not found: ${sitePackagesBase}`);
	}
	let spDir = sitePackagesBase;
	if (process.platform !== 'win32') {
		const entries = readdirSync(spDir, { withFileTypes: true });
		const pyDir = entries.find(e => e.isDirectory() && e.name.startsWith('python'));
		if (pyDir) {
			spDir = join(spDir, pyDir.name);
		}
	}
	const modelsDir = join(spDir, 'rapidocr_onnxruntime', 'models');
	if (!existsSync(modelsDir)) {
		throw new Error(`rapidocr models not found: ${modelsDir}`);
	}
	return modelsDir;
}

const OCR_MODELS_DIR = findRapidOCRModelsDir();

function ocrBinaryPath(): string {
	const name = 'ocr_pipeline_opencv' + (process.platform === 'win32' ? '.exe' : '');
	const candidates = [
		resolve(BUILD_DIR, 'Release', name),
		resolve(BUILD_DIR, name),
	];
	return candidates.find(c => existsSync(c)) || candidates[0];
}

export function existsOcrBinary(): boolean {
	return existsSync(ocrBinaryPath());
}

export async function ocrFrameOpenCvCpp(
	framePath: string,
	opts?: { textScore?: number; subtitleOnly?: boolean; device?: string },
): Promise<OCRLine[]> {
	const r = spawnSync(ocrBinaryPath(), [
		framePath,
		...(opts?.textScore != null ? [String(opts.textScore)] : []),
		...(opts?.subtitleOnly ? ['--subtitle-only'] : []),
		...(opts?.device && opts.device !== 'cpu' ? ['--device', opts.device] : []),
	], {
		timeout: 60_000,
		encoding: 'utf-8',
		env: ocrEnv(),
	});

	if (r.status !== 0) {
		throw new Error(`ocr_pipeline_opencv failed (exit ${r.status}): ${(r.stderr || '').slice(-300)}`);
	}

	return parseOcrOutput(r.stdout);
}

export async function ocrFramesOpenCvCpp(
	frameDir: string,
	opts?: { textScore?: number; subtitleOnly?: boolean; device?: string },
): Promise<Map<string, OCRLine[]>> {
	const r = spawnSync(ocrBinaryPath(), [
		'--dir', frameDir,
		...(opts?.textScore != null ? [String(opts.textScore)] : []),
		...(opts?.subtitleOnly ? ['--subtitle-only'] : []),
		...(opts?.device && opts.device !== 'cpu' ? ['--device', opts.device] : []),
	], {
		timeout: 120_000,
		encoding: 'utf-8',
		env: ocrEnv(),
	});

	if (r.status !== 0) {
		throw new Error(`ocr_pipeline_opencv --dir failed (exit ${r.status}): ${(r.stderr || '').slice(-300)}`);
	}

	const result = new Map<string, OCRLine[]>();
	for (const line of r.stdout.trim().split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const item = JSON.parse(trimmed);
		const lines = parseJsonItem(item);
		const filename = item.file || '';
		result.set(filename, lines);
	}
	return result;
}

function ocrEnv(): Record<string, string> {
	return {
		...process.env,
		[LIB_PATH_KEY]: `${BUILD_DIR}${process.platform === 'win32' ? ';' : ':'}${process.env[LIB_PATH_KEY] || ''}`,
		OCR_MODELS_DIR,
		OCR_KEYS_PATH,
	};
}

function parseOcrOutput(stdout: string): OCRLine[] {
	const parsed = JSON.parse(stdout);
	return parseJsonItem(parsed);
}

function parseJsonItem(item: any): OCRLine[] {
	const lines: OCRLine[] = [];
	for (const seg of item.segments || []) {
		lines.push({
			text: seg.text,
			confidence: seg.confidence,
			box: seg.box || [],
		});
	}
	if (lines.length === 0 && item.text) {
		lines.push({ text: item.text, confidence: 1, box: [] });
	}
	return lines;
}
