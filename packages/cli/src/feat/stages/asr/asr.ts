import { spawn, spawnSync } from 'node:child_process';
import { readJson, writeJson, ensureDir, removeFile } from '../utils/fileOps.ts';
import { copyFileSync, existsSync, renameSync } from 'node:fs';
import { delimiter, join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { runStage, getTorchServerUrl } from '../../../ml/server/client.ts';

import {  emitLog, ffmpeg, nowISO, readTaskLanguages, srtTime, videoSourcePath, vocalsPath, mixedVocalsPath, gatedVocalsPath } from '../utils/utils.ts';
import { AsrOptions } from './types.ts';
import { parseAsrOutput } from './utils.ts';
import { Context, setCtx, setStage } from '../../context/context.ts';
import { pythonBin } from '@repo/config/path/bin';
import { findServer } from '@repo/core/servers/discovery';
import { REPO_ROOT } from '@repo/config/path/root';
import { whisperCppModelPath } from '@repo/config/path/models';
import { asrWhisperCpp } from '../../../ml/whisper/runtime/ggml.ts';
import { asrFasterWhisper } from '../../../ml/whisper/runtime/faster_whisper_py.ts';


export async function stageAsr(
	ctx: Context,
) {
	const taskId = ctx.task.id;
  const sessionPath = ctx.task.session_path
	await setStage(sessionPath, 'asr', {
		last_message: 'Transcribing...',
		progress: 0,
	});
	const audioVocal = ctx.input?.stages?.asr?.vocalAudioPath ?? vocalsPath(sessionPath);
	const videoSource =  videoSourcePath(ctx);

	let audioPath = ctx.input?.stages?.asr?.useSeparated
		? audioVocal
		: videoSource;
	if (!existsSync(audioPath))
		throw new Error(
			`ASR input not found: ${audioPath}; 如果 asr.useSeparated=true, 请确保 target_3_vocals.wav 存在；如果 asr.useSeparated=false, 请确保 video_source.mp4 存在`,
		);

	if (ctx.input?.stages?.asr?.useSeparated) {
		const mixedPath = mixedVocalsPath(sessionPath);
		const gatedPath = gatedVocalsPath(sessionPath);
		const mixedOrGated = existsSync(gatedPath) ? gatedPath
			: existsSync(mixedPath) ? mixedPath
			: null;
		if (mixedOrGated) {
			audioPath = mixedOrGated;
			emitLog(sessionPath, `[ASR] Using pre-mixed audio: ${mixedOrGated}`);
		} else {
			emitLog(sessionPath, `[ASR] No mixed audio found, using vocals-only`);
		}
	}

	const asrCfg = ctx.input?.stages?.asr;
	const runtime = asrCfg?.runtime ?? 'pytorch';
	const device = asrCfg?.device ?? 'cuda';
	emitLog(sessionPath, `[ASR] runtime=${runtime} device=${device}`);

	const pyBin = pythonBin();
	const { asrLanguage } = readTaskLanguages(ctx);

	if (runtime === 'pytorch') {
		emitLog(sessionPath, `[ASR] Using Torch server (device=${device})`);
		const {port} = await findServer('torch')
		const asrUrl = getTorchServerUrl(port);
		const result = await runStage(asrUrl, 'asr', taskId, {
			vocals_path: audioPath,
			session_path: sessionPath,
			language: asrLanguage || 'auto',
			device,
			word_timestamps: asrCfg?.wordsOutput ?? false,
		});
		const r = result as Record<string, any>;
		const actualDevice: string = r.actual_device ?? device;
		const fallbackToCpu = device !== 'cpu' && actualDevice === 'cpu';
		if (fallbackToCpu) {
			console.warn(
				`[WARN] [ASR] GPU failed, fell back to CPU (actual device: ${actualDevice})`,
			);
		}
		if (r.detected_language) {
			setCtx(sessionPath, {
				asr_language: r.detected_language,
				runInfo: {
					asr: {
						engine: 'whisper-pytorch',
						device: actualDevice,
						gpuAttempted: device !== 'cpu',
						fallbackToCpu,
					},
				},
			});
		}
		if (r.load_time_s)
			emitLog(sessionPath, `[ASR] Model loaded in ${r.load_time_s}s`);
		if (r.process_time_s)
			emitLog(sessionPath, `[ASR] Transcribed in ${r.process_time_s}s`);
		if (r.audio_duration_s)
			emitLog(
				sessionPath,
				`[ASR] Audio duration ${Number(r.audio_duration_s).toFixed(1)}s`,
			);
		if (r.rtf) emitLog(sessionPath, `[ASR] RTF ${r.rtf}`);
	} else if (runtime === 'ggml') {
		await asrWhisperCpp(ctx, audioPath, sessionPath, asrLanguage || 'auto');
	} else {
		await asrFasterWhisper({ ctx, taskId, audioPath, sessionPath: sessionPath, language: asrLanguage, device, pythonBin: pyBin });
	}

	/**
	 * asr 后处理, 避免 asr_fix 拿到多余数据
	 */
	// 统一过滤超出音频时长的幻觉段（所有路径 shared）
	const asrDir = join(sessionPath, 'asr');
	const asrFile = join(asrDir, 'asr.json');
	if (existsSync(asrFile)) {
		const data = await readJson(asrFile, ctx);
		const durationMs = data.audio_info?.duration ?? 0;
		if (durationMs > 0 && data.result?.segments?.length) {
			const before = data.result.segments.length;
			data.result.segments = data.result.segments.filter(
				(u: Record<string, any>) => u.start < durationMs && u.end > 0,
			);
			if (data.result.segments.length < before) {
				const removed = before - data.result.segments.length;
				emitLog(sessionPath, `[ASR] Removed ${removed} hallucinated segment(s) (start >= ${durationMs}ms or end <= 0ms)`);
				writeJson(asrFile, data, ctx);
			}
		}

		// 能量检测：最后一个 segment 如果 RMS 过低则判为幻觉
		const last = data.result?.segments?.[data.result.segments.length - 1];
		if (last && existsSync(audioPath)) {
			const rms = await segmentRms(audioPath, last.start, last.end);
			console.log(`[ASR] Last segment RMS: ${rms}`);
			if (rms > 0 && rms < 0.005) {
				const removed = data.result.segments.pop();
				emitLog(sessionPath, `[ASR] Removed low-energy hallucinated segment "${removed.text.slice(0, 30)}" (RMS=${rms.toFixed(5)})`);
				writeJson(asrFile, data, ctx);
			}
		}
	}

	await setStage(sessionPath, 'asr', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
		last_message: 'Transcribed',
	});
}


function segmentRms(audioPath: string, startMs: number, endMs: number): Promise<number> {
	return new Promise((resolve, reject) => {
		const args = [
			'-y', '-i', audioPath,
			'-ss', String(startMs / 1000),
			'-to', String(endMs / 1000),
			'-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
			'-f', 'null', '-',
		];
		const proc = spawn('ffmpeg', args, { timeout: 30_000 });
		let stderr = '';
		proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
		proc.on('close', (code) => {
			if (code !== 0) return resolve(0);
			const m = stderr.match(/lavfi\.astats\.Overall\.RMS_level=([-\d.]+)/);
			if (!m) return resolve(0);
			const dB = parseFloat(m[1]);
			// dB → linear: linear = 10^(dB/20)
			resolve(Math.pow(10, dB / 20));
		});
		proc.on('error', () => resolve(0));
	});
}
