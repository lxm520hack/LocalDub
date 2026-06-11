import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pythonBin, REPO_ROOT } from "../../feat/config/config.ts";

const OCR_PY = join(
	REPO_ROOT,
	"packages",
	"benchmark",
	"ocr",
	"compute",
	"ocr_frame.py",
);

export interface OCRLine {
	text: string;
	confidence: number;
	box: number[][];
}

export function ocrFrame(
	framePath: string,
	opts?: { textScore?: number },
): OCRLine[] {
	const args = [OCR_PY, framePath, "--subtitle-only"];
	const textScore = opts?.textScore ?? 0.3;
	args.push("--text-score", String(textScore));

	const r = spawnSync(pythonBin(), args, {
		timeout: 60_000,
		encoding: "utf-8",
	});
	if (r.status !== 0) {
		throw new Error(
			`OCR failed (exit ${r.status}): ${(r.stderr || "").slice(-200)}`,
		);
	}
	const parsed = JSON.parse(r.stdout);
	if (parsed.error) throw new Error(`OCR error: ${parsed.error}`);
	return parsed;
}
