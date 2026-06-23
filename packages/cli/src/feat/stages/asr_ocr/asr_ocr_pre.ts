import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureDir, writeJson, readJson } from '../utils/fileOps.ts';
import { emitLog, nowISO, srtTime, videoSourcePath } from '../utils/utils.ts';
import type { Segment } from '../utils/ocrMerge.ts';
import { Context, setStage } from '../../context/context.ts';

// Split long ASR segments by punctuation using word-level timestamps
const SPLIT_PAT = /[，,。！？.!?]/;
const MIN_SUB_DUR = 800;
function splitAsrByWords(segs: { text: string; start: number; end: number; words?: { word: string; start: number; end: number; probability: number }[] }[]): Segment[] {
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
		// Filter split points: keep if remaining segment (after the split) >= MIN_SUB_DUR
		const useIdx: number[] = [];
		const totalEnd = ws[ws.length - 1].end;
		for (let i = 0; i < splitIdx.length - 1; i++) {
			const endMs = ws[splitIdx[i]].end;
			if (totalEnd - endMs >= MIN_SUB_DUR) {
				useIdx.push(splitIdx[i]);
			}
		}
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

export async function stageAsrOcrPre(ctx: Context) {
	const sessionPath = ctx.task.session_path;

	await setStage(sessionPath, 'asr_ocr_pre', {
		last_message: 'Splitting ASR segments by punctuation...',
		progress: 0,
	});

	const videoPath = videoSourcePath(sessionPath);
	if (!existsSync(videoPath)) {
		throw new Error(`Video not found: ${videoPath}`);
	}

	const asrFile = join(sessionPath, 'metadata', 'asr.json');
	if (!existsSync(asrFile)) {
		throw new Error(`asr.json not found: ${asrFile}`);
	}

	const asrData = await readJson(asrFile, ctx);
	const asrSegsRaw: { text: string; start: number; end: number; words?: { word: string; start: number; end: number; probability: number }[] }[] =
		(asrData.result?.segments ?? []).map((s: any) => ({
			text: s.text,
			start: Math.round(s.start),
			end: Math.round(s.end),
			words: s.words,
		}));

	if (!asrSegsRaw.length) throw new Error('No ASR segments found');

	// Step 1: Split ASR segments by punctuation
	const asrSegs = splitAsrByWords(asrSegsRaw);

	const preDir = resolve(sessionPath, 'asr_ocr_pre');
	ensureDir(preDir, ctx);

	// Write asr_split.json
	writeJson(
		join(preDir, 'asr_split.json'),
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

	emitLog(sessionPath, `[asr_ocr_pre] ${asrSegsRaw.length} ASR segs → ${asrSegs.length} split segs`);

	// Step 2: Generate frame timestamps (end2fps strategy)
	await setStage(sessionPath, 'asr_ocr_pre', {
		last_message: `Extracting ${asrSegs.length} split segments frames...`,
		progress: 10,
	});

	const allTimestamps = new Set<number>();
	for (let i = 0; i < asrSegs.length; i++) {
		const seg = asrSegs[i];
		if (i === 0) {
			for (let t = Math.round(seg.start); t <= Math.round(seg.end); t += 100) {
				allTimestamps.add(Math.round(t));
			}
		} else {
			for (let t = Math.round(seg.end); t >= seg.start; t -= 500) {
				allTimestamps.add(Math.round(t));
			}
		}
	}
	const sortedTs = [...allTimestamps].sort((a, b) => a - b);

	emitLog(sessionPath, `[asr_ocr_pre] ${asrSegs.length} split segs → ${sortedTs.length} frame positions`);

	// Step 3: Extract frames
	const frameDir = join(sessionPath, 'asr_ocr_pre', 'frames');
	ensureDir(frameDir, ctx);

	let extractCount = 0;
	for (let i = 0; i < sortedTs.length; i++) {
		const ts = sortedTs[i];
		const framePath = join(frameDir, `frame_${ts.toString().padStart(7, '0')}.jpg`);
		const r = spawnSync('ffmpeg', [
			'-y', '-ss', String(ts / 1000), '-i', videoPath,
			'-frames:v', '1', '-qscale:v', '2', framePath,
		], { timeout: 15_000, encoding: 'utf-8' });
		if (r.status !== 0) continue;
		extractCount++;

		if ((i + 1) % 50 === 0 || i === sortedTs.length - 1) {
			emitLog(sessionPath, `[asr_ocr_pre] Extracted ${i + 1}/${sortedTs.length} frames`);
		}
	}

	if (!extractCount) {
		throw new Error('No frames extracted');
	}

	emitLog(sessionPath, `[asr_ocr_pre] ${extractCount} frames extracted to ${frameDir}`);

	await setStage(sessionPath, 'asr_ocr_pre', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
	});
}
