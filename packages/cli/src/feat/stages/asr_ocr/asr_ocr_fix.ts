import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureDir, writeJson, readJson } from '../utils/fileOps.ts';
import { emitLog, nowISO, srtTime, probeVideoResolution, videoSourcePath } from '../utils/utils.ts';
import { FrameResult, Segment, fixOverlap, toOcrFiltered } from '../utils/ocrMerge.ts';
import { computeBoxYStats, computeSegmentAdjustments } from '../ocr/utils.ts';
import { Context, setStage } from '../../context/context.ts';

export async function stageAsrOcrFix(ctx: Context) {
	const sessionPath = ctx.task.session_path;

	await setStage(sessionPath, 'asr_ocr_fix', {
		last_message: 'Fusing ASR + OCR...',
		progress: 0,
	});

	const metadataDir = resolve(sessionPath, 'metadata');
	const asrOcrPreDir = resolve(sessionPath, 'asr_ocr_pre');
	const asrOcrDir = resolve(sessionPath, 'asr_ocr');
	const asrOcrFixDir = resolve(sessionPath, 'asr_ocr_fix');

	// Read inputs
	const asrFile = join(metadataDir, 'asr.json');
	const asrSplitFile = join(asrOcrPreDir, 'asr_split.json');
	const ocrFramesFile = join(asrOcrDir, 'ocr_frames.json');
	const ocrFile = join(asrOcrDir, 'asr_ocr.json');

	if (!existsSync(asrFile)) throw new Error(`asr.json not found: ${asrFile}`);
	if (!existsSync(asrSplitFile)) throw new Error(`asr_split.json not found, run asr_ocr_pre first`);
	if (!existsSync(ocrFramesFile)) throw new Error(`ocr_frames.json not found, run asr_ocr first`);
	if (!existsSync(ocrFile)) throw new Error(`asr_ocr.json not found, run asr_ocr first`);

	ensureDir(asrOcrFixDir, ctx);

	const asrData = await readJson(asrFile, ctx);
	const asrSplitData = await readJson(asrSplitFile, ctx);
	const ocrFramesData = await readJson(ocrFramesFile, ctx);
	const ocrData = await readJson(ocrFile, ctx);

	const asrSegsRaw: { text: string; start: number; end: number; words?: { word: string; start: number; end: number; probability: number }[] }[] =
		(asrData.result?.segments ?? []).map((s: any) => ({
			text: s.text,
			start: Math.round(s.start),
			end: Math.round(s.end),
			words: s.words,
		}));

	const asrSegs: Segment[] = (asrSplitData.result?.segments ?? []).map((s: any) => ({
		text: s.text,
		start: Math.round(s.start),
		end: Math.round(s.end),
	}));

	const ocrSegs: Segment[] = (ocrData.result?.segments ?? []).map((s: any) => ({
		text: s.text,
		start: Math.round(s.start),
		end: Math.round(s.end),
		confidence: s.confidence,
		box_y: s.box_y,
	}));

	// rawFrames 用于 fixOverlap 的帧级别时间边界修正
	const rawFrames: FrameResult[] = (ocrFramesData._frames_raw ?? []);

	const asrOcrFixCfg = ctx.input?.stages?.asr_ocr_fix;
	const textScore = asrOcrFixCfg?.textScore ?? 0.45;

	if (!asrSegs.length) throw new Error('No ASR segments found');
	if (!ocrSegs.length) throw new Error('No OCR segments found (empty asr_ocr.json)');

	// ========== ocr_merged.json：对 asr_ocr.json 的 segments 做置信度调整（Y 偏移 + 孤立惩罚） ==========
	const yStats = computeBoxYStats(rawFrames);
	const { height: videoHeight } = probeVideoResolution(videoSourcePath(sessionPath));
	const isoThresholdMs = asrOcrFixCfg?.isoThresholdMs ?? 1500;
	const adjustYWeight = asrOcrFixCfg?.adjustYWeight ?? 0.8;
	const adjustIsoWeight = asrOcrFixCfg?.adjustIsoWeight ?? 0.2;
	const adjustYFactor = asrOcrFixCfg?.adjustYFactor ?? 0.08;
	const adjustedSegs = computeSegmentAdjustments(ocrSegs, rawFrames, yStats, videoHeight, isoThresholdMs, adjustYWeight, adjustIsoWeight, adjustYFactor);

	writeJson(
		join(asrOcrFixDir, 'ocr_merged.json'),
		{
			_engine: 'asr_ocr',
			_fusion_params: { strategy: 'end2fps', isoThresholdMs, adjustYWeight, adjustIsoWeight, adjustYFactor },
			result: {
				text: adjustedSegs.map(s => s.text).join(' '),
				segments: adjustedSegs.map(s => ({
					text: s.text,
					start: s.start,
					end: s.end,
					start_fmt: srtTime(s.start),
					end_fmt: srtTime(s.end),
					confidence: s.confidence,
					...(s.box_y ? { box_y: s.box_y } : {}),
					frameCount: s.frameCount,
					adjustedConfidence: s.adjustedConfidence,
					yPenalty: s.yPenalty,
					isoPenalty: s.isoPenalty,
				})),
			},
		},
		ctx,
	);

	// ========== ocr_filtered.json：以 asr_ocr.json 的 segments 为输入，按 segment confidence 过滤 ==========
	const { segments: ocrSegsMerged, dropped } = toOcrFiltered(ocrSegs, textScore);

	writeJson(
		join(asrOcrFixDir, 'ocr_filtered.json'),
		{
			audio_info: { duration: ocrSegsMerged.length > 0 ? ocrSegsMerged[ocrSegsMerged.length - 1].end : 0 },
			_boundary: 'ocr',
			_fusion_params: { strategy: 'end2fps', ocrCalls: ocrSegsMerged.length, textScore, dropped },
			result: {
				text: ocrSegsMerged.map(s => s.text).join(' '),
				segments: ocrSegsMerged.map(s => ({
					text: s.text,
					start: s.start,
					end: s.end,
					start_fmt: srtTime(s.start),
					end_fmt: srtTime(s.end),
					confidence: s.confidence,
					box_y: s.box_y,
				})),
			},
		},
		ctx,
	);

	// ========== asr_ocr_merged.json：复用 ocr_filtered.json 的 segments，时间边界对齐到 ASR ==========
	// 对每个 OCR segment，找到时间上最重叠的 ASR segment，用 ASR 的 start/end 作为新边界
	const asrOcrSegs: Segment[] = ocrSegsMerged.map(seg => {
		let bestAsr: Segment | undefined = undefined;
		let bestOverlap = 0;
		for (const asr of asrSegs) {
			const overlapStart = Math.max(seg.start, asr.start);
			const overlapEnd = Math.min(seg.end, asr.end);
			const overlap = Math.max(0, overlapEnd - overlapStart);
			if (overlap > bestOverlap) {
				bestOverlap = overlap;
				bestAsr = asr;
			}
		}
		return {
			text: seg.text,
			start: bestAsr ? bestAsr.start : seg.start,
			end: bestAsr ? bestAsr.end : seg.end,
			confidence: seg.confidence,
			box_y: seg.box_y,
		};
	});

	const asrOcrText = asrOcrSegs.map(s => s.text).join(' ');

	writeJson(
		join(asrOcrFixDir, 'asr_ocr_merged.json'),
		{
			audio_info: { duration: asrOcrSegs.length > 0 ? asrOcrSegs[asrOcrSegs.length - 1].end : 0 },
			_engine: 'asr_ocr',
			_fusion_params: { strategy: 'end2fps', ocrCalls: ocrSegsMerged.length, asrSegs: asrSegsRaw.length, asrSplits: asrSegs.length, textScore, dropped },
			result: {
				text: asrOcrText,
				segments: asrOcrSegs.map(s => ({
					text: s.text,
					start: s.start,
					end: s.end,
					start_fmt: srtTime(s.start),
					end_fmt: srtTime(s.end),
					confidence: s.confidence,
				})),
			},
		},
		ctx,
	);

	// Write asr_ocr_fused.json — fixOverlap fused result
	const maxAdvanceMs = ctx.input?.stages?.merge_audio?.maxAdvanceMs ?? 500;
	const fix = fixOverlap(asrOcrSegs, rawFrames, ocrSegsMerged, maxAdvanceMs).filter(
		s => s.end > s.start,
	);
	const fixText = fix.map(s => s.text).join(' ');
	writeJson(
		join(asrOcrFixDir, 'asr_ocr_fused.json'),
		{
			_engine: 'asr_ocr',
			_fusion_params: { strategy: 'end2fps', maxAdvanceMs, ocrCalls: ocrSegsMerged.length, asrSegs: asrSegsRaw.length, asrSplits: asrSegs.length, fixSegs: fix.length, textScore, dropped },
			result: {
				text: fixText,
				segments: fix.map(s => ({
					text: s.text,
					start: s.start,
					end: s.end,
					start_fmt: srtTime(s.start),
					end_fmt: srtTime(s.end),
					confidence: s.confidence,
				})),
			},
		},
		ctx,
	);

	emitLog(sessionPath, `[asr_ocr_fix] ${ocrSegs.length} OCR segs (dropped ${dropped} below textScore=${textScore}) → ${asrSegsRaw.length} ASR → ${asrSegs.length} split → ${asrOcrSegs.length} merged, ${fix.length} fused`);

	await setStage(sessionPath, 'asr_ocr_fix', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
	});
}
