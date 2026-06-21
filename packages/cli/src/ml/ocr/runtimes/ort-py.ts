import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, pythonBin } from '../../../feat/config/config.ts';

export interface OCRLine {
	text: string;
	confidence: number;
	box: number[][];
}

const PY_SCRIPT = resolve(REPO_ROOT, 'packages', 'subtitle-ocr', 'subtitle-py.py');

export async function ocrFramePy(
	framePath: string,
	opts?: { textScore?: number; subtitleOnly?: boolean },
): Promise<OCRLine[]> {
	if (!existsSync(PY_SCRIPT)) {
		throw new Error(`Python OCR script not found: ${PY_SCRIPT}`);
	}

	const pyBin = pythonBin();
	const args: string[] = [PY_SCRIPT, framePath];
	if (opts?.textScore != null) {
		args.push('--text-score', String(opts.textScore));
	}
	if (opts?.subtitleOnly) {
		args.push('--subtitle-only');
	}

	const r = spawnSync(pyBin, args, {
		timeout: 60_000,
		encoding: 'utf-8',
	});

	if (r.status !== 0) {
		throw new Error(`subtitle-py failed (exit ${r.status}): ${(r.stderr || '').slice(-300)}`);
	}

	const parsed = JSON.parse(r.stdout);

	const lines: OCRLine[] = [];
	for (const seg of parsed.lines || []) {
		lines.push({
			text: seg.text,
			confidence: seg.confidence,
			box: seg.box || [],
		});
	}
	return lines;
}
