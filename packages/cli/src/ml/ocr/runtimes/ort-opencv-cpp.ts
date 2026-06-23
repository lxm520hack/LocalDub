import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { getRapidOCRModelsDir } from '../rapidocr-models.ts';
import { REPO_ROOT } from '../../../feat/config/config.ts';

export interface OCRLine {
	text: string;
	confidence: number;
	box: number[][];
}

const BUILD_DIR = resolve(REPO_ROOT, 'packages', 'subtitle-ocr', 'subtitle-opencv-cpp', 'build');
const OCR_KEYS_PATH = resolve(REPO_ROOT, 'packages', 'subtitle-ocr', 'ppocr_keys.json');
const LIB_PATH_KEY = process.platform === 'win32' ? 'PATH' : 'LD_LIBRARY_PATH';

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

	const parsed = parseBatchOutput(r.stdout);
	const filename = basename(framePath);
	return parsed.get(filename) || [];
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

	return parseBatchOutput(r.stdout);
}

function ocrEnv(): Record<string, string | undefined> {
	return {
		...process.env,
		[LIB_PATH_KEY]: `${BUILD_DIR}${process.platform === 'win32' ? ';' : ':'}${process.env[LIB_PATH_KEY] || ''}`,
		OCR_MODELS_DIR: getRapidOCRModelsDir(),
		OCR_KEYS_PATH,
	};
}

function parseBatchOutput(stdout: string): Map<string, OCRLine[]> {
	const items: any[] = JSON.parse(stdout);
	const result = new Map<string, OCRLine[]>();
	for (const item of items) {
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
		result.set(item.file || '', lines);
	}
	return result;
}
