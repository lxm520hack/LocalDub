import { OCRLine } from '@repo/subtitle-ocr/types';
import { OcrAfterAdjustArgs } from '@repo/core/input/types';
import { FrameResult, Segment, SegmentWithAdjusted } from '@repo/core/ml/subtitle_ocr/types';
import { LineAdjustedArgs } from '@repo/core/ml/subtitle_ocr/input';

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
	avgHeight: number;
} {
	const lineBoxes = frames
		.flatMap(f => f.lines ?? [])
		.filter(l => l.text.trim());
	if (lineBoxes.length === 0) return { avg: [0, 0], mode: [0, 0], avgHeight: 0 };

	const boxYs = lineBoxes.map(l => [l.bbox.top, l.bbox.bottom] as [number, number]);

	const avgTop = Math.round(boxYs.reduce((s, [t]) => s + t, 0) / boxYs.length);
	const avgBtm = Math.round(boxYs.reduce((s, [, b]) => s + b, 0) / boxYs.length);
	const avgHeight = Math.round(lineBoxes.reduce((s, l) => s + (l.bbox.bottom - l.bbox.top), 0) / lineBoxes.length);

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

	return { avg: [avgTop, avgBtm], mode, avgHeight };
}
export type YStats = ReturnType<typeof computeBoxYStats>;

export const build_ocr_frames_line_adjust = (
	ocrFrames: FrameResult[], 
	yStats: YStats,
	{ lineAdjustedThreshold = 0.5 }: LineAdjustedArgs
)=> ocrFrames.map(f => ({
	...f,
	lines: f.lines?.map(l => {
		if (!l.text.trim()) return { ...l, top: 0, bottom: 0, top_offset_ratio: 0, bot_offset_ratio: 0, height: 0, height_ratio: 0, is_outlier: false, adjustedConfidence: l.confidence };
		const top = l.bbox.top;
		const bottom = l.bbox.bottom;
		const height = bottom - top;
		const topOR = yStats.avgHeight > 0 ? Math.abs(top - yStats.avg[0]) / yStats.avgHeight : 0;
		const botOR = yStats.avgHeight > 0 ? Math.abs(bottom - yStats.avg[1]) / yStats.avgHeight : 0;
		const heightRatio = yStats.avgHeight > 0
			? Math.round((height / yStats.avgHeight) * 100) / 100
			: 0;
		const bandDrift = Math.max(topOR, botOR);
		const noisePenalty = Math.min(1,
			Math.max(0, (bandDrift - 1.0) * 0.5) +
			Math.abs(1 - heightRatio) * 0.3,
		);
		const adjustedConfidence = Math.round(l.confidence * (1 - noisePenalty) * 100) / 100;
		const isOutlier = adjustedConfidence < lineAdjustedThreshold;
		return {
			...l,
			top,
			bottom,
			top_offset_ratio: Math.round(topOR * 100) / 100,
			bot_offset_ratio: Math.round(botOR * 100) / 100,
			height: Math.round(height * 10) / 10,
			height_ratio: heightRatio,
			is_outlier: isOutlier,
			adjustedConfidence,
		};
	}),
}));
type OcrFramesLineAdjustFrame = ReturnType<typeof build_ocr_frames_line_adjust>[number];

export const get_ocr_frames_line_filtered = (ocrFramesLineAdjustFrames: OcrFramesLineAdjustFrame[]) => ocrFramesLineAdjustFrames.flatMap(f => {
	if (!f.lines) return [f as FrameResult];
	const cleanLines = f.lines.filter(l => !l.is_outlier);
	if (cleanLines.length === 0) return [];
	if (cleanLines.length === f.lines.length) return [f as FrameResult];
	const rebuilt = joinOcrLines(cleanLines.map(l => ({
		text: l.text,
		confidence: l.confidence,
		box: l.box,
	})));
	return [{
		...f,
		text: rebuilt.text,
		confidence: rebuilt.confidence,
		bbox: rebuilt.bbox,
		lines: rebuilt.lines,
	} as FrameResult];
});

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
