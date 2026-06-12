export interface FrameResult {
	text: string;
	timestamp: number;
	confidence: number;
	box?: number[][];
}

export interface Segment {
	text: string;
	start: number;
	end: number;
	box_y?: [number, number];
}

export function levenshtein(a: string, b: string): number {
	const m = a.length, n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
	for (let i = 0; i <= m; i++) dp[i][0] = i;
	for (let j = 0; j <= n; j++) dp[0][j] = j;
	for (let i = 1; i <= m; i++)
		for (let j = 1; j <= n; j++)
			dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
	return dp[m][n];
}

function boxY(box?: number[][]): [number, number] | undefined {
	if (!box || box.length < 4) return undefined;
	const ys = box.map(p => p[1]);
	return [Math.min(...ys), Math.max(...ys)];
}

function overlap(a?: [number, number], b?: [number, number]): boolean {
	if (!a || !b) return false;
	return a[0] < b[1] && b[0] < a[1];
}

function isSubstringOf(a: string, b: string): boolean {
	if (!a || !b || a.length === b.length) return false;
	return a.length < b.length ? b.includes(a) : a.includes(b);
}

export function mergeFrames(frames: FrameResult[]): Segment[] {
	const segments: Segment[] = [];
	let currentText = "";
	let currentStart = 0;
	let currentBox: number[][] | undefined;
	let gapStart = 0;

	for (const f of frames) {
		if (!f.text) {
			if (currentText && !gapStart) gapStart = f.timestamp;
			continue;
		}
		if (gapStart > 0) {
			const gapMs = f.timestamp - gapStart;
			if (gapMs <= 1500 && levenshtein(f.text, currentText) <= 2) {
				gapStart = 0; continue;
			}
			segments.push({ text: currentText, start: currentStart, end: gapStart, box_y: boxY(currentBox) });
			currentText = ""; currentStart = 0; currentBox = undefined; gapStart = 0;
		}
		if (!currentText || levenshtein(f.text, currentText) > 2) {
			if (currentText) {
				segments.push({
					text: currentText,
					start: currentStart,
					end: f.timestamp,
					box_y: boxY(currentBox),
				});
			}
			currentText = f.text;
			currentStart = f.timestamp;
			currentBox = f.box;
		}
	}
	if (currentText) {
		const lastTs = gapStart > 0 ? gapStart : frames[frames.length - 1]?.timestamp ?? currentStart;
		segments.push({ text: currentText, start: currentStart, end: lastTs, box_y: boxY(currentBox) });
	}

	// second pass: merge adjacent segments where text is a substring of the other
	// and Y positions overlap (handles OCR single-character hallucination like 身→绝不起身)
	for (let i = segments.length - 1; i > 0; i--) {
		const prev = segments[i - 1];
		const cur = segments[i];
		if (overlap(prev.box_y, cur.box_y) && isSubstringOf(prev.text, cur.text)) {
			segments[i - 1] = { text: cur.text, start: prev.start, end: cur.end, box_y: cur.box_y };
			segments.splice(i, 1);
		}
	}

	// third pass: A-B-C triplet where A.text == C.text and B is a short hallucination
	// (handles patterns like "嗯发财了" → "菌" → "嗯发财了")
	for (let i = 0; i < segments.length - 2; i++) {
		const a = segments[i];
		const b = segments[i + 1];
		const c = segments[i + 2];
		if (levenshtein(a.text, c.text) <= 2 && overlap(a.box_y, b.box_y) && overlap(b.box_y, c.box_y)) {
			const durB = b.end - b.start;
			const isShort = durB <= 1000;
			const isSingleChar = b.text.length <= 2;
			if (isShort && isSingleChar) {
				segments[i] = { text: a.text, start: a.start, end: c.end, box_y: a.box_y };
				segments.splice(i + 1, 2);
				i--; // re-check from this position
			}
		}
	}

	return segments.filter((s) => s.end - s.start >= 500);
}
