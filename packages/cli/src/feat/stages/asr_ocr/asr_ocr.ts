import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { newOcrEngine, type OCRRuntime } from '../../../ml/ocr/ocr.ts';
import { ensureDir, writeJson, readJson } from '@repo/core/utils/fileOps';
import { emitLog, nowISO, videoSourcePath } from '@repo/core/stages/utils/utils.ts';
import { joinOcrLines, computeBoxYStats } from '../ocr/utils.ts';
import { Context, setStage } from '@repo/core/context/context.ts';
import { startLog } from '../utils/log.ts';
import { probeVideoDuration } from '@repo/core/utils/utils'
import { FrameResult, Segment, SegmentWithAdjusted } from "@repo/core/ml/subtitle_ocr/types";

export async function stageAsrOcr(ctx: Context) {
	const sessionPath = ctx.task.session_path;
	startLog(ctx.task.current_stage, ctx.task.id)
	setStage(sessionPath, 'asr_ocr', {
		last_message: `OCR'ing frames...`,
		progress: 0,
	});

	const frameDir = join(sessionPath, 'asr_ocr_pre', 'frames');
	if (!existsSync(frameDir)) {
		throw new Error(`Frame directory not found: ${frameDir} — run asr_ocr_pre first`);
	}

	const asrOcrCfg = ctx.input?.stages?.asr_ocr;
	const textScore = asrOcrCfg?.textScore ?? 0.45;
	const subtitleOnly = asrOcrCfg?.subtitleOnly ?? true;
	const runtime = (asrOcrCfg?.runtime ?? 'ort-cpp') as OCRRuntime;
	const device = (asrOcrCfg?.device ?? 'cpu') as 'cpu' | 'cuda' | 'directml' | 'coreml' | 'rocm' | 'mps';
	const cleanupFrames = asrOcrCfg?.cleanupFrames ?? false;

	// OCR each frame
	const engine = await newOcrEngine(runtime, device);

	const frameFiles = readdirSync(frameDir).filter(f => f.endsWith('.jpg')).sort();
	const linesArr = await engine.ocrFrames(frameDir, frameFiles, { textScore, subtitleOnly });
	const frameResults: FrameResult[] = [];

	for (let i = 0; i < frameFiles.length; i++) {
		const tsMatch = frameFiles[i].match(/frame_(\d+)\.jpg/);
		const timestampMs = tsMatch ? parseInt(tsMatch[1]) : 0;
		const lines = linesArr[i];
		const r = joinOcrLines(lines);
		frameResults.push({ ...r, timestamp: timestampMs });

		if ((i + 1) % 50 === 0 || i === frameFiles.length - 1) {
			emitLog(sessionPath, `[asr_ocr] ${i + 1}/${frameFiles.length} frames`);
		}
	}
	await engine.release();

	const asrOcrDir = resolve(sessionPath, 'asr_ocr');
	ensureDir(asrOcrDir, ctx);

	// Write ocr_frames.json — raw frame data for debugging/reproducibility
	writeJson(
		join(asrOcrDir, 'ocr_frames.json'),
		{
			_frames_raw: frameResults,
			audio_info: { duration:  probeVideoDuration(videoSourcePath(ctx)) },
			_source: 'asr_ocr',
			_engine: runtime,
			_device: device,
		},
		ctx,
	);

	// Cleanup frames (optional)
	if (cleanupFrames) {
		rmSync(frameDir, { recursive: true, force: true });
		emitLog(sessionPath, `[asr_ocr] Frames cleaned up`);
	} else {
		emitLog(sessionPath, `[asr_ocr] Frames kept at ${frameDir}`);
	}

	setStage(sessionPath, 'asr_ocr', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
	});
}
