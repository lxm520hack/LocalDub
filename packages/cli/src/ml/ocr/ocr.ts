import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPO_ROOT } from "../../feat/config/config.ts";

const BINARY_PATH = resolve(REPO_ROOT, "packages", "ocr-cpp", "build", "ocr_pipeline");
const LD_PATH = resolve(REPO_ROOT, "packages", "ocr-cpp", "build");

const LIB_PATH_KEY = process.platform === "win32" ? "PATH" : "LD_LIBRARY_PATH";

export interface OCRLine {
	text: string;
	confidence: number;
	box: number[][];
}

export function ocrFrame(
	framePath: string,
	opts?: { textScore?: number; subtitleOnly?: boolean },
): OCRLine[] {
	if (!existsSync(BINARY_PATH)) {
		throw new Error(
			`ocr_pipeline binary not found at ${BINARY_PATH}. Run 'npm run build' in packages/ocr-cpp/`,
		);
	}

	const args: string[] = [framePath];
	if (opts?.textScore != null) args.push(String(opts.textScore));
	if (opts?.subtitleOnly) args.push("--subtitle-only");

	const r = spawnSync(BINARY_PATH, args, {
		timeout: 60_000,
		encoding: "utf-8",
		env: {
			...process.env,
			[LIB_PATH_KEY]: LD_PATH,
		},
	});

	if (r.status !== 0) {
		throw new Error(
			`ocr_pipeline failed (exit ${r.status}): ${(r.stderr || "").slice(-300)}`,
		);
	}

	const parsed = JSON.parse(r.stdout);

	const lines: OCRLine[] = [];
	for (const seg of parsed.segments || []) {
		lines.push({
			text: seg.text,
			confidence: seg.confidence,
			box: seg.box || [],
		});
	}
	if (lines.length === 0 && parsed.text) {
		lines.push({ text: parsed.text, confidence: 1, box: [] });
	}
	return lines;
}
