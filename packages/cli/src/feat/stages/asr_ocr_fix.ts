import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureDir, writeJson, readJson } from './utils/fileOps.ts';
import { emitLog, nowISO, srtTime } from './utils/utils.ts';
import { FrameResult, Segment, fixOverlap, toOcrFiltered } from './utils/ocrMerge.ts';
import { Context, setStage } from '../context/context.ts';

export async function stageAsrOcrFix(ctx: Context) {
	const sessionPath = ctx.task.session_path;

	await setStage(sessionPath, 'asr_ocr_fix', {
		last_message: 'Fusing ASR + OCR...',
		progress: 0,
	});

	const metadataDir = resolve(sessionPath, 'metadata');

	// Read inputs
	const asrFile = join(metadataDir, 'asr.json');
	const ocrFramesFile = join(metadataDir, 'ocr_frames.json');
	const ocrFile = join(metadataDir, 'asr_ocr.json');

	if (!existsSync(asrFile)) throw new Error(`asr.json not found: ${asrFile}`);
	if (!existsSync(ocrFramesFile)) throw new Error(`ocr_frames.json not found, run asr_ocr first`);
	if (!existsSync(ocrFile)) throw new Error(`asr_ocr.json not found, run asr_ocr first`);

	const asrData = await readJson(asrFile, ctx);
	const ocrFramesData = await readJson(ocrFramesFile, ctx);
	const ocrData = await readJson(ocrFile, ctx);

	const asrSegsRaw: { text: string; start: number; end: number; words?: { word: string; start: number; end: number; probability: number }[] }[] =
		(asrData.result?.segments ?? []).map((s: any) => ({
			text: s.text,
			start: Math.round(s.start),
			end: Math.round(s.end),
			words: s.words,
		}));

	// Split long ASR segments by punctuation using word-level timestamps
	const SPLIT_PAT = /[，,。！？.!?]/;
	const MIN_SUB_DUR = 800;
	function splitAsrByWords(segs: typeof asrSegsRaw): Segment[] {
		return segs.flatMap(seg => {
			const ws = seg.words;
			if (!ws || ws.length < 2 || seg.end - seg.start < 3000) {
				return [{ text: seg.text, start: seg.start, end: seg.end }];
			}
			const splitIdx: number[] = [];
			for (let i = 0; i < ws.length; i++) {
				if (SPLIT_PAT.test(ws[i].word)) {
					splitIdx.push(i);
				}
			}
			if (splitIdx.length <= 1) {
				return [{ text: seg.text, start: seg.start, end: seg.end }];
			}
			// Filter split points that would produce sub-segments >= MIN_SUB_DUR
			const useIdx: number[] = [];
			const totalEnd = ws[ws.length - 1].end;
			// First potential split is index 0 — always use last punctuation as boundary
			for (let i = 0; i < splitIdx.length - 1; i++) {
				const endMs = ws[splitIdx[i]].end;
				// Duration of sub-segment from last split (or segment start) to this split
				const from = useIdx.length > 0 ? ws[useIdx[useIdx.length - 1] + 1].start : ws[0].start;
				if (endMs - from >= MIN_SUB_DUR) {
					useIdx.push(splitIdx[i]);
				}
			}
			// Always include the final punctuation
			useIdx.push(splitIdx[splitIdx.length - 1]);
			if (useIdx.length <= 1) {
				return [{ text: seg.text, start: seg.start, end: seg.end }];
			}
			const subSegs: Segment[] = [];
			let prevIdx = 0;
			for (let i = 0; i < useIdx.length - 1; i++) {
				const endIdx = useIdx[i];
				subSegs.push({
					text: ws.slice(prevIdx, endIdx + 1).map(w => w.word).join(''),
					start: ws[prevIdx].start,
					end: ws[endIdx].end,
				});
				prevIdx = endIdx + 1;
			}
			subSegs.push({
				text: ws.slice(prevIdx).map(w => w.word).join(''),
				start: ws[prevIdx].start,
				end: totalEnd,
			});
			return subSegs;
		});
	}

	const asrSegs = splitAsrByWords(asrSegsRaw);

	// Write asr_split.json
	writeJson(
		join(metadataDir, 'asr_split.json'),
		{
			_source: 'asr_split',
			_original_segments: asrSegsRaw.length,
			_split_segments: asrSegs.length,
			result: {
				text: asrSegs.map(s => s.text).join(' '),
				segments: asrSegs.map(s => ({
					text: s.text,
					start: s.start,
					end: s.end,
					start_fmt: srtTime(s.start),
					end_fmt: srtTime(s.end),
				})),
			},
		},
		ctx,
	);

	const ocrSegs: Segment[] = (ocrData.result?.segments ?? []).map((s: any) => ({
		text: s.text,
		start: Math.round(s.start),
		end: Math.round(s.end),
		confidence: s.confidence,
		box_y: s.box_y,
	}));

	// rawFrames 用于 fixOverlap 的帧级别时间边界修正
	const rawFrames: FrameResult[] = (ocrFramesData._frames_raw ?? []);

	const textScore = ctx.input?.stages?.asr_ocr_fix?.textScore ?? 0.45;

	if (!asrSegs.length) throw new Error('No ASR segments found');
	if (!ocrSegs.length) throw new Error('No OCR segments found (empty asr_ocr.json)');

	// ========== ocr_filtered.json：以 asr_ocr.json 的 segments 为输入，按 segment confidence 过滤 ==========
	const { segments: ocrSegsMerged, dropped } = toOcrFiltered(ocrSegs, textScore);

	writeJson(
		join(metadataDir, 'ocr_filtered.json'),
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
		join(metadataDir, 'asr_ocr_merged.json'),
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
		join(metadataDir, 'asr_ocr_fused.json'),
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
