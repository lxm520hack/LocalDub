import type { OCRLine } from '../../../ml/ocr/ocr.ts';
import { OcrAfterAdjustArgs } from '../../input/types.ts';
import type { FrameResult, Segment, SegmentWithAdjusted } from './ocrMerge.ts';

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

export function computeBoxYStats(frames: FrameResult[]): {
	avg: [number, number];
	mode: [number, number];
} {
	const nonEmpty = frames.filter(f => f.bbox && f.text);
	if (nonEmpty.length === 0) return { avg: [0, 0], mode: [0, 0] };

	const boxYs = nonEmpty.map(f => [f.bbox!.top, f.bbox!.bottom] as [number, number]);

	const avgTop = Math.round(boxYs.reduce((s, [t]) => s + t, 0) / boxYs.length);
	const avgBtm = Math.round(boxYs.reduce((s, [, b]) => s + b, 0) / boxYs.length);

	const counts = new Map<string, { count: number; pair: [number, number] }>();
	let maxCount = 0;
	let mode: [number, number] = boxYs[0];
	for (const pair of boxYs) {
		const key = `${pair[0]},${pair[1]}`;
		const entry = counts.get(key) ?? { count: 0, pair };
		entry.count++;
		counts.set(key, entry);
		if (entry.count > maxCount) {
			maxCount = entry.count;
			mode = pair;
		}
	}

	return { avg: [avgTop, avgBtm], mode };
}

export function computeSegmentAdjustments(
	segments: Segment[],
	frameResults: FrameResult[],
	yStats: { avg: [number, number]; mode: [number, number] },
	videoHeight: number,
	{
	isoThresholdMs = 1500,
	adjustYWeight = 0.8,
	adjustIsoWeight = 0.2,
	adjustYFactor = 0.08,
	}: OcrAfterAdjustArgs,
): SegmentWithAdjusted[] {
	if (segments.length === 0 || !yStats.avg[0] && yStats.avg[1] === 0) return segments;

	const avgCentroid = (yStats.avg[0] + yStats.avg[1]) / 2;

	// build sorted non-empty frame timestamps for isolation search
	const nonEmptyTs = frameResults
		.filter(f => f.text && f.bbox)
		.map(f => f.timestamp)
		.sort((a, b) => a - b);

	return segments.map(seg => {
		if (seg.frameCount === undefined || seg.confidence === undefined) return seg;

		// Y penalty: centroid offset relative to video height
		let yPenalty = 0;
		if (seg.box_y) {
			const centroid = (seg.box_y[0] + seg.box_y[1]) / 2;
			const offset = Math.abs(centroid - avgCentroid);
			yPenalty = Math.min(1, offset / (videoHeight * adjustYFactor));
		}

		// Isolation penalty: only for single-frame segments
		let isoPenalty = 0;
		if (seg.frameCount === 1) {
			const mid = (seg.start + seg.end) / 2;
			const nonEmptyBefore = [...nonEmptyTs].reverse().find(t => t < mid);
			const nonEmptyAfter = nonEmptyTs.find(t => t > mid);
			const gapBefore = nonEmptyBefore !== undefined ? mid - nonEmptyBefore : Infinity;
			const gapAfter = nonEmptyAfter !== undefined ? nonEmptyAfter - mid : Infinity;
			const nearestGap = Math.min(gapBefore, gapAfter);
			isoPenalty = Math.min(1, nearestGap / isoThresholdMs);
		}

		const totalPenalty = adjustYWeight * yPenalty + adjustIsoWeight * isoPenalty;
		const adjustedConfidence = seg.confidence * Math.max(0, 1 - totalPenalty);

		return {
			...seg,
			adjustedConfidence: Math.round(adjustedConfidence * 100) / 100,
			yPenalty: Math.round(yPenalty * 100) / 100,
			isoPenalty: Math.round(isoPenalty * 100) / 100,
		};
	});
}
