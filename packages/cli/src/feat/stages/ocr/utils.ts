import type { OCRLine } from '../../../ml/ocr/ocr.ts';

function polygonToBbox(box: number[][]): { left: number; top: number; right: number; bottom: number } {
	if (!box || box.length < 2) return { left: 0, top: 0, right: 0, bottom: 0 };
	const xs = box.map(p => p[0]);
	const ys = box.map(p => p[1]);
	return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

export function joinOcrLines(lines: OCRLine[]): {
	text: string;
	confidence: number;
	bbox: { left: number; top: number; right: number; bottom: number };
	lines: { text: string; confidence: number; box: number[][]; bbox: { left: number; top: number; right: number; bottom: number } }[];
} {
	if (lines.length === 0) {
		return { text: '', confidence: 0, bbox: { left: 0, top: 0, right: 0, bottom: 0 }, lines: [] };
	}
	if (lines.length === 1) {
		const b = polygonToBbox(lines[0].box);
		return {
			text: lines[0].text,
			confidence: lines[0].confidence,
			bbox: b,
			lines: [{ text: lines[0].text, confidence: lines[0].confidence, box: lines[0].box, bbox: b }],
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
	const lineBboxes = lines.map(l => polygonToBbox(l.box));
	const combinedBbox = {
		left: Math.min(...lineBboxes.map(b => b.left)),
		top: Math.min(...lineBboxes.map(b => b.top)),
		right: Math.max(...lineBboxes.map(b => b.right)),
		bottom: Math.max(...lineBboxes.map(b => b.bottom)),
	};
	return {
		text: lines.map(l => l.text).join(sameLine ? ' ' : '\n'),
		confidence: avgConf,
		bbox: combinedBbox,
		lines: lines.map((l, i) => ({ text: l.text, confidence: l.confidence, box: l.box, bbox: lineBboxes[i] })),
	};
}
