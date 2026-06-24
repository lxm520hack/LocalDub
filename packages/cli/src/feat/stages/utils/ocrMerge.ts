export interface FrameResult {
	text: string;
	timestamp: number;
	confidence: number;
	box?: number[][];
	bbox?: { left: number; top: number; right: number; bottom: number };
	lines?: { text: string; confidence: number; box: number[][]; bbox: { left: number; top: number; right: number; bottom: number } }[];
}

export interface Segment {
	text: string;
	start: number;
	end: number;
	box_y?: [number, number];
	confidence?: number;
	frameCount?: number;
	adjustedConfidence?: number;
	yPenalty?: number;
	isoPenalty?: number;
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

function avgConfidence(confidences: number[]): number | undefined {
	return confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : undefined;
}

function mergeConfidence(a?: number, b?: number): number | undefined {
	if (a === undefined) return b;
	if (b === undefined) return a;
	return (a + b) / 2;
}

const normalize = (s: string) => s.replace(/\s+/g, '');

export function mergeFrames(frames: FrameResult[]): Segment[] {
	const segments: Segment[] = [];
	let currentText = "";
	let currentStart = 0;
	let currentBoxY: [number, number] | undefined;
	let gapStart = 0;
	let currentConfidences: number[] = [];

	function frameBoxY(f: FrameResult): [number, number] | undefined {
		return f.bbox ? [f.bbox.top, f.bbox.bottom] : undefined;
	}

	for (const f of frames) {
		if (!f.text) {
			if (currentText && !gapStart) gapStart = f.timestamp;
			continue;
		}
		if (gapStart > 0) {
			const gapMs = f.timestamp - gapStart;
			if (gapMs <= 1500 && (normalize(f.text) === normalize(currentText) || isSubstringOf(f.text, currentText) || isSubstringOf(currentText, f.text))) {
				currentConfidences.push(f.confidence);
				gapStart = 0; continue;
			}
			segments.push({ text: currentText, start: currentStart, end: gapStart, box_y: currentBoxY, confidence: avgConfidence(currentConfidences), frameCount: currentConfidences.length });
			currentText = ""; currentStart = 0; currentBoxY = undefined; gapStart = 0; currentConfidences = [];
		}
		if (!currentText || normalize(f.text) !== normalize(currentText)) {
			if (currentText) {
				segments.push({
					text: currentText,
					start: currentStart,
					end: f.timestamp,
					box_y: currentBoxY,
					confidence: avgConfidence(currentConfidences),
					frameCount: currentConfidences.length,
				});
			}
			currentText = f.text;
			currentStart = f.timestamp;
			currentBoxY = frameBoxY(f);
			currentConfidences = [f.confidence];
		} else {
			currentConfidences.push(f.confidence);
		}
	}
	if (currentText) {
		const lastTs = gapStart > 0 ? gapStart : frames[frames.length - 1]?.timestamp ?? currentStart;
		segments.push({ text: currentText, start: currentStart, end: lastTs, box_y: currentBoxY, confidence: avgConfidence(currentConfidences), frameCount: currentConfidences.length });
	}

	// second pass: merge adjacent segments where text is a substring of the other
	// and Y positions overlap (handles OCR single-character hallucination like 身→绝不起身)
	for (let i = segments.length - 1; i > 0; i--) {
		const prev = segments[i - 1];
		const cur = segments[i];
		if (overlap(prev.box_y, cur.box_y) && isSubstringOf(prev.text, cur.text)) {
			segments[i - 1] = { text: cur.text, start: prev.start, end: cur.end, box_y: cur.box_y, confidence: mergeConfidence(prev.confidence, cur.confidence), frameCount: (prev.frameCount ?? 1) + (cur.frameCount ?? 1) };
			segments.splice(i, 1);
		}
	}

	// third pass: A-B-C triplet where A.text == C.text and B is a short hallucination
	// (handles patterns like "嗯发财了" → "菌" → "嗯发财了", or same-text segments
	// split by a one-word noise like "娘带着我们门爬了七座山才到")
	for (let i = 0; i < segments.length - 2; i++) {
		const a = segments[i];
		const b = segments[i + 1];
		const c = segments[i + 2];
		if (levenshtein(a.text, c.text) <= 2 && overlap(a.box_y, b.box_y) && overlap(b.box_y, c.box_y)) {
			const durB = b.end - b.start;
			const isShort = durB <= 1000;
			// 中间段是一个 OCR 噪声：要么它本身就很短（<=1000ms），要么
			// 它和 a/c 的文本差异很小且长度差不多（中间插入一个字的噪声）
			const bNearA = levenshtein(b.text, a.text) <= 2 && Math.abs(b.text.length - a.text.length) <= 2;
			const bNearC = levenshtein(b.text, c.text) <= 2 && Math.abs(b.text.length - c.text.length) <= 2;
			const isNoise = isShort || bNearA || bNearC;
			if (isNoise) {
				const mergedConf = [a.confidence, b.confidence, c.confidence].filter((v): v is number => v !== undefined);
				segments[i] = { text: a.text, start: a.start, end: c.end, box_y: a.box_y, confidence: avgConfidence(mergedConf), frameCount: (a.frameCount ?? 1) + (b.frameCount ?? 1) + (c.frameCount ?? 1) };
				segments.splice(i + 1, 2);
				i--; // re-check from this position
			}
		}
	}

	// fourth pass: remove overlapping segments with similar text
	// (handles ASR segment overlap where end2fps scans produce duplicate
	// segments with lev-distant text like 干嘛/于嘛 in the same time window)
	dedupOverlap(segments);

	// fifth pass: merge adjacent segments with the same normalized text
	// (handles A → noise → A cut by a frame gap where the triplet didn't fire
	// because noise was a single long segment, e.g. same subtitle resumed after
	// a punctuation/breath pause split the ASR slice)
	for (let i = segments.length - 1; i > 0; i--) {
		const prev = segments[i - 1];
		const cur = segments[i];
		if (normalize(prev.text) !== normalize(cur.text)) continue;
		const gap = cur.start - prev.end;
		if (gap < 0 || gap > 2000) continue; // 不重叠 + 间隔不超过 2s 才合并
		prev.end = cur.end;
		const mergedConf = [prev.confidence, cur.confidence].filter((v): v is number => v !== undefined);
		prev.confidence = avgConfidence(mergedConf);
		prev.frameCount = (prev.frameCount ?? 1) + (cur.frameCount ?? 1);
		segments.splice(i, 1);
	}

	return segments;
}

export function dedupOverlap(segments: Segment[]): Segment[] {
	for (let i = 0; i < segments.length; i++) {
		for (let j = i + 1; j < segments.length; j++) {
			const a = segments[i];
			const b = segments[j];
			if (!a || !b) continue;
			if (a.start < b.end && b.start < a.end && levenshtein(a.text, b.text) <= 2) {
				segments[i] = {
					text: a.text.length >= b.text.length ? a.text : b.text,
					start: Math.min(a.start, b.start),
					end: Math.max(a.end, b.end),
					box_y: a.box_y,
					confidence: mergeConfidence(a.confidence, b.confidence),
					frameCount: (a.frameCount ?? 1) + (b.frameCount ?? 1),
				};
				segments.splice(j, 1);
				j--;
			}
		}
	}
	return segments;
}

export function fixOverlap(asrSegs: Segment[], rawFrames: FrameResult[], ocrSegs: Segment[], maxAdvanceMs = 500): Segment[] {
	const fix = asrSegs.map((s) => ({ ...s }));
	const sorted = [...rawFrames].sort((a, b) => a.timestamp - b.timestamp);

	for (let i = 1; i < fix.length; i++) {
		const prev = fix[i - 1];
		const cur = fix[i];
		if (cur.start >= prev.end) continue;
		const overlapEnd = Math.min(prev.end, cur.end);
		for (const f of sorted) {
			if (f.timestamp < cur.start) continue;
			if (f.timestamp > overlapEnd) break;
			const dCur = levenshtein(f.text, cur.text);
			const dPrev = levenshtein(f.text, prev.text);
			if (dCur <= 2 && dCur < dPrev) {
				prev.end = f.timestamp;
				cur.start = f.timestamp;
				break;
			}
		}
	}

	for (const seg of fix) {
		let bestOcr: Segment | null = null;
		let bestOverlap = 0;
		for (const o of ocrSegs) {
			const overlap = Math.min(seg.end, o.end) - Math.max(seg.start, o.start);
			if (overlap > bestOverlap && levenshtein(seg.text, o.text) <= 2) {
				bestOverlap = overlap;
				bestOcr = o;
			}
		}
		if (bestOcr && seg.start + maxAdvanceMs < bestOcr.start) {
			seg.start = bestOcr.start;
		}
	}

	return fix;
}

/**
 * 从 ocr.json 的 segments 出发，按 segment confidence 过滤，生成 ocr_filtered.json 的结果。
 * 如果 segment 已带有 adjustedConfidence（Y 偏移 + 孤立惩罚后的置信度），则优先用它过滤。
 *
 * @param segments 来自 ocr.json.result.segments（mergeFrames 结果），或 computeSegmentAdjustments 的输出
 * @param textScore confidence 阈值，低于此值的 segment 会被丢弃。0 表示不过滤。
 * @returns 过滤后的 segments，以及被丢弃的数量
 */
export function toOcrFiltered(
	segments: Segment[],
	textScore: number,
): { segments: Segment[]; dropped: number } {
	if (!textScore || textScore <= 0) {
		return { segments: segments.map(s => ({ ...s })), dropped: 0 };
	}
	const filtered = segments.filter(s => {
		const score = (s as any).adjustedConfidence !== undefined
			? (s as any).adjustedConfidence
			: s.confidence;
		return score === undefined || score >= textScore;
	});
	return {
		segments: filtered,
		dropped: segments.length - filtered.length,
	};
}
