import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OCREngine, type OCRRuntime } from '../../../ml/ocr/ocr.ts';
import { ensureDir, writeJson, readJson } from '../utils/fileOps.ts';
import { emitLog, nowISO, srtTime } from '../utils/utils.ts';
import { FrameResult, mergeFrames } from '../utils/ocrMerge.ts';
import { Context, setStage } from '../../context/context.ts';

export async function stageAsrOcr(ctx: Context) {
	const sessionPath = ctx.task.session_path;
	await setStage(sessionPath, 'asr_ocr', {
		last_message: `OCR'ing frames...`,
		progress: 0,
	});

	const frameDir = join(sessionPath, 'tmp', 'asr-ocr-frames');
	if (!existsSync(frameDir)) {
		throw new Error(`Frame directory not found: ${frameDir} — run asr_ocr_pre first`);
	}

	const asrOcrCfg = ctx.input?.stages?.asr_ocr;
	const textScore = asrOcrCfg?.textScore ?? 0.45;
	const subtitleOnly = asrOcrCfg?.subtitleOnly ?? true;
	const runtime = (asrOcrCfg?.runtime ?? 'ort-opencv-cpp') as OCRRuntime;
	const device = (asrOcrCfg?.device ?? 'cpu') as 'cpu' | 'cuda' | 'directml' | 'coreml' | 'rocm' | 'mps';
	const cleanupFrames = asrOcrCfg?.cleanupFrames ?? false;

	// OCR each frame
	const engine = new OCREngine(runtime, device);
	await engine.init();

	const frameFiles = readdirSync(frameDir).filter(f => f.endsWith('.jpg')).sort();
	const linesArr = await engine.ocrFrames(frameDir, frameFiles, { textScore, subtitleOnly });
	const frameResults: FrameResult[] = [];

	for (let i = 0; i < frameFiles.length; i++) {
		const tsMatch = frameFiles[i].match(/frame_(\d+)\.jpg/);
		const timestampMs = tsMatch ? parseInt(tsMatch[1]) : 0;
		const lines = linesArr[i];
		if (lines.length === 0) {
			frameResults.push({
				text: '',
				timestamp: timestampMs,
				confidence: 0,
				box: [],
			});
		} else if (lines.length === 1) {
			frameResults.push({
				text: lines[0].text,
				timestamp: timestampMs,
				confidence: lines[0].confidence,
				box: lines[0].box,
			});
		} else {
			// Multiple text lines per frame: join with space if Y ranges overlap (same line),
			// otherwise newline (different lines)
			const yRanges = lines.map(l => {
				const ys = l.box.map(p => p[1]);
				return { min: Math.min(...ys), max: Math.max(...ys) };
			});
			let sameLine = false;
			for (let a = 0; a < yRanges.length - 1 && !sameLine; a++) {
				for (let b = a + 1; b < yRanges.length && !sameLine; b++) {
					if (yRanges[a].max >= yRanges[b].min && yRanges[b].max >= yRanges[a].min) {
						sameLine = true;
					}
				}
			}
			const combinedText = lines.map(l => l.text).join(sameLine ? ' ' : '\n');
			const bestConf = lines.reduce((a, b) => a.confidence > b.confidence ? a : b).confidence;
			frameResults.push({
				text: combinedText,
				timestamp: timestampMs,
				confidence: bestConf,
				box: lines[0].box,
				lines: lines.map(l => ({ text: l.text, confidence: l.confidence, box: l.box })),
			});
		}

		if ((i + 1) % 50 === 0 || i === frameFiles.length - 1) {
			emitLog(sessionPath, `[asr_ocr] ${i + 1}/${frameFiles.length} frames`);
		}
	}
	await engine.release();

	// Merge frames into OCR segments
	const ocrSegments = mergeFrames(frameResults);
	const ocrText = ocrSegments.map(s => s.text).join(' ');
	const audioDurMs = ocrSegments.length > 0 ? ocrSegments[ocrSegments.length - 1].end : 0;

	// probe video duration fallback
	const probe = spawnSync('ffprobe', [
		'-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(sessionPath, 'media', 'video_source.mp4'),
	], { timeout: 15_000, encoding: 'utf-8' });
	const videoDurationS = parseFloat(probe.stdout?.trim() || '0');

	const metadataDir = resolve(sessionPath, 'metadata');
	ensureDir(metadataDir, ctx);

	const ocrSegmentsOut = ocrSegments.map(s => ({
		text: s.text,
		start: s.start,
		end: s.end,
		start_fmt: srtTime(s.start),
		end_fmt: srtTime(s.end),
		confidence: s.confidence,
		...(s.box_y ? { box_y: s.box_y } : {}),
	}));

	// Write ocr_frames.json — raw frame data for debugging/reproducibility
	writeJson(
		join(metadataDir, 'ocr_frames.json'),
		{
			_frames_raw: frameResults,
			_ocr_segments: ocrSegmentsOut,
		},
		ctx,
	);

	// Write asr_ocr.json — pure OCR-boundary segments (from mergeFrames)
	writeJson(
		join(metadataDir, 'asr_ocr.json'),
		{
			audio_info: { duration: audioDurMs || Math.round(videoDurationS * 1000) },
			_source: 'asr_ocr',
			_engine: runtime,
			_device: device,
			result: { text: ocrText, segments: ocrSegmentsOut },
		},
		ctx,
	);

	emitLog(sessionPath, `[asr_ocr] ${frameFiles.length} OCR frames → ${ocrSegments.length} OCR segments`);

	// Cleanup frames (optional)
	if (cleanupFrames) {
		rmSync(frameDir, { recursive: true, force: true });
		emitLog(sessionPath, `[asr_ocr] Frames cleaned up`);
	} else {
		emitLog(sessionPath, `[asr_ocr] Frames kept at ${frameDir}`);
	}

	await setStage(sessionPath, 'asr_ocr', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
	});
}
