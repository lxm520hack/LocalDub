import type { OCRLine } from '../../../ml/ocr/ocr.ts';

export function joinOcrLines(lines: OCRLine[]): {
	text: string;
	confidence: number;
	box?: number[][];
	lines?: { text: string; confidence: number; box: number[][] }[];
} {
	if (lines.length <= 1) {
		return {
			text: lines[0]?.text ?? '',
			confidence: lines[0]?.confidence ?? 0,
			box: lines[0]?.box ?? [],
		};
	}
	const yRanges = lines.map(l => {
		const ys = l.box.map(p => p[1]);
		return { min: Math.min(...ys), max: Math.max(...ys) };
	});
	let sameLine = false;
	for (let a = 0; a < yRanges.length - 1 && !sameLine; a++) {
		for (let b = a + 1; b < yRanges.length && !sameLine; b++) {
			if (yRanges[a].max >= yRanges[b].min && yRanges[b].max >= yRanges[a].min) sameLine = true;
		}
	}
	const avgConf = lines.reduce((s, l) => s + l.confidence, 0) / lines.length;
	return {
		text: lines.map(l => l.text).join(sameLine ? ' ' : '\n'),
		confidence: avgConf,
		lines: lines.map(l => ({ text: l.text, confidence: l.confidence, box: l.box })),
	};
}
