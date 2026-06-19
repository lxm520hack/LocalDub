import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureDir, writeJson, readJson } from './utils/fileOps.ts';
import { emitLog, nowISO, srtTime } from './utils/utils.ts';
import { FrameResult, Segment, mergeFrames, fixOverlap } from './utils/ocrMerge.ts';
import { Context, setStage } from '../context/context.ts';

export async function stageAsrOcrFix(ctx: Context) {
	const sessionPath = ctx.task.session_path;
	const taskId = ctx.task.id;

	await setStage(sessionPath, 'asr_ocr_fix', {
		last_message: 'Fusing ASR + OCR...',
		progress: 0,
	});

	const metadataDir = resolve(sessionPath, 'metadata');

	// Read inputs
	const asrFile = join(metadataDir, 'asr.json');
	const ocrFramesFile = join(metadataDir, 'ocr_frames.json');
	const ocrFile = join(metadataDir, 'ocr.json');

	if (!existsSync(asrFile)) throw new Error(`asr.json not found: ${asrFile}`);
	if (!existsSync(ocrFramesFile)) throw new Error(`ocr_frames.json not found, run asr_ocr first`);
	if (!existsSync(ocrFile)) throw new Error(`ocr.json not found, run asr_ocr first`);

	const asrData = await readJson(asrFile, ctx);
	const ocrFramesData = await readJson(ocrFramesFile, ctx);
	const ocrData = await readJson(ocrFile, ctx);

	const asrSegs: Segment[] = (asrData.result?.segments ?? []).map((s: any) => ({
		text: s.text,
		start: Math.round(s.start),
		end: Math.round(s.end),
	}));

	const frameResults: FrameResult[] = (ocrFramesData._frames_raw ?? []);
	const ocrSegments: Segment[] = (ocrData.result?.segments ?? []).map((s: any) => ({
		text: s.text,
		start: Math.round(s.start),
		end: Math.round(s.end),
	}));

	if (!asrSegs.length) throw new Error('No ASR segments found');
	if (!frameResults.length) throw new Error('No OCR frames found (empty ocr_frames.json)');

	// ASR-guided boundaries: mergeFrames handles Levenshtein + substring + triplet + dedup
	const asrSegsMerged = mergeFrames(frameResults);
	const asrOcrText = asrSegsMerged.map(s => s.text).join(' ');

	const segmentsOut = asrSegsMerged.map(s => ({
		text: s.text,
		start: s.start,
		end: s.end,
		start_fmt: srtTime(s.start),
		end_fmt: srtTime(s.end),
	}));

	// Write asr_ocr_merged.json — ASR-guided boundaries with merged OCR text
	writeJson(
		join(metadataDir, 'asr_ocr_merged.json'),
		{
			audio_info: { duration: asrSegsMerged.length > 0 ? asrSegsMerged[asrSegsMerged.length - 1].end : 0 },
			_engine: 'asr_ocr',
			_fusion_params: { strategy: 'end2fps', ocrCalls: frameResults.length, asrSegs: asrSegs.length },
			result: {
				text: asrOcrText,
				segments: segmentsOut,
			},
		},
		ctx,
	);

	// Write asr_ocr_fused.json — fixOverlap fused result
	const maxAdvanceMs = ctx.input?.stages?.merge_audio?.maxAdvanceMs ?? 500;
	const fix = fixOverlap(asrSegsMerged, frameResults, ocrSegments, maxAdvanceMs).filter(
		s => s.end > s.start,
	);
	const fixText = fix.map(s => s.text).join(' ');
	writeJson(
		join(metadataDir, 'asr_ocr_fused.json'),
		{
			_engine: 'asr_ocr',
			_fusion_params: { strategy: 'end2fps', maxAdvanceMs, ocrCalls: frameResults.length, asrSegs: asrSegs.length, fixSegs: fix.length },
			result: {
				text: fixText,
				segments: fix.map(s => ({
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

	emitLog(sessionPath, `[ASR+OCR-FIX] ${frameResults.length} OCR frames → ${asrSegsMerged.length} merged segs, ${fix.length} fused segs`);

	await setStage(sessionPath, 'asr_ocr_fix', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
	});
}
