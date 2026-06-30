import { spawn, spawnSync } from 'node:child_process';
import { readJson, writeJson, ensureDir, removeFile } from '../utils/fileOps.ts';
import { copyFileSync, existsSync, renameSync } from 'node:fs';
import { delimiter, join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { runStage, getTorchServerUrl } from '../../../ml/server/client.ts';

import {  emitLog, ffmpeg, nowISO, readTaskLanguages, srtTime, videoSourcePath, vocalsPath, mixedVocalsPath, gatedVocalsPath } from '../utils/utils.ts';
import { ensureWhisperCpp, ensureVadModel, whisperCppBinaryPath } from '../../../ml/whisper/ensure.ts';
import { AsrOptions } from './types.ts';
import { parseAsrOutput } from './utils.ts';
import { Context, setCtx, setStage } from '../../context/context.ts';
import { pythonBin } from '@repo/config/path/exe';
import { findServer } from '@repo/core/servers/discovery';
import { REPO_ROOT } from '@repo/config/path/root';
import { whisperCppModelPath } from '@repo/config/path/models';
import { asrWhisperCpp } from './ggml.ts';

const VAD_CANDIDATES: Record<string, string[]> = {
	'silero-v5': [
		'silero-v5.1.2',
		'silero-vad-v5',
	],
	'silero-v6': [
		'silero-v6.2.0',
		'silero-vad-v6',
	],
};

const VAD_SEARCH_DIRS: string[] = [
	join(homedir(), '.cache', 'pywhispercpp'),
	join(REPO_ROOT, 'submodule', 'whisper.cpp', 'models'),
];

function resolveVadModel(name: string): string {
	const candidates = VAD_CANDIDATES[name];
	if (!candidates) return name;
	for (const dir of VAD_SEARCH_DIRS) {
		for (const c of candidates) {
			const p = join(dir, `ggml-${c}.bin`);
			if (existsSync(p)) return p;
			// fallback: allow versioned filenames like ggml-silero-vad-v6.2.0.bin
			try {
				const files = require('node:fs').readdirSync(dir);
				for (const f of files) {
					if (!f.startsWith('ggml-') || !f.endsWith('.bin')) continue;
					if (f.includes(c) || f.includes(c.split('.')[0])) return join(dir, f);
				}
			} catch (e) {
				// ignore and continue
			}
		}
	}
	const dir = join(REPO_ROOT, 'submodule', 'whisper.cpp', 'models');
	throw new Error(
		`VAD model '${name}' not found. Install via:\n` +
		`  bash ${dir}/download-vad-model.sh ${candidates[0]}\n` +
		`Expected locations: ${VAD_SEARCH_DIRS.map(d => `\n  - ${d}/ggml-{${candidates.join(',')}}.bin`).join('')}`
	);
}



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

async function asrPytorch(opts: AsrOptions) {
	let { taskId, audioPath, sessionPath: sessionPath, language, device, pythonBin: pyBin, ctx } = opts;
	const script = join(
		REPO_ROOT,
		'packages',
		'cli',
		'scripts',
		'asr',
		'pytorch.py',
	);

	if (device === 'cuda') {
		const cudaResult = spawnSync(pyBin, [
			'-c',
			'import torch; print(torch.cuda.is_available())',
		]);
		const cudaOk =
			cudaResult.status === 0 &&
			(cudaResult.stdout?.toString().trim() ?? '') === 'True';
		if (!cudaOk) {
			console.warn(
				`[WARN] [ASR] torch.cuda.is_available()=${cudaOk}, falling back to CPU`,
			);
			device = 'cpu';
		}
	}

	const attempts = device !== 'cpu' ? 2 : 1;
	let fallbackToCpu = false;

	const emitWords = ctx.input?.stages?.asr?.wordsOutput ?? false;
	for (let attempt = 0; attempt < attempts; attempt++) {
		const actualDevice = attempt === 0 ? device : 'cpu';
		const args = [
			script,
			audioPath,
			sessionPath,
			language || 'auto',
			'--device',
			actualDevice,
		];
		if (emitWords) args.push('--word-timestamps');
		const t0 = Date.now();
		const result = spawnSync(pyBin, args, {
			maxBuffer: 256 * 1024 * 1024,
			timeout: 600_000,
		});
		const elapsedSec = (Date.now() - t0) / 1000;

		if (result.error || result.signal || result.status !== 0) {
			if (attempt === 0 && device !== 'cpu') {
				const stderr = (result.stderr?.toString() || '').trim().slice(-200);
				console.warn(
					`[WARN] [ASR] GPU failed (${result.error?.message || `signal ${result.signal}` || `exit ${result.status}`}), retrying CPU: ${stderr}`,
				);
				await setStage(sessionPath, 'asr', {
					last_message: 'GPU failed, retrying CPU...',
				});
				fallbackToCpu = true;
				continue;
			}
			if (result.error)
				throw new Error(`Python ASR subprocess failed: ${result.error.message}`);
			if (result.signal)
				throw new Error(
					`ASR killed by signal ${result.signal}: ${(result.stderr?.toString() || '').trim().slice(-200)}`,
				);
			throw new Error(
				`Python ASR exited with status ${result.status}: ${result.stderr?.toString() || ''}`,
			);
		}

		const asrOutputPath = parseAsrOutput(result.stdout?.toString() || '');
		if (!asrOutputPath || !existsSync(asrOutputPath)) {
			throw new Error(`Python ASR did not produce output at ${asrOutputPath}`);
		}

		const asr = await readJson(asrOutputPath, ctx);
		if (asr.detected_language) {
			setCtx(sessionPath, {
				asr_language: asr.detected_language,
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
		emitAsrTiming(sessionPath, asr, elapsedSec);
		return;
	}
}


function emitAsrTiming(sessionPath: string, asr: Record<string, any>, elapsedSec: number) {
	emitLog(sessionPath, `[ASR] Transcribed in ${elapsedSec.toFixed(1)}s`);
	const durationMs = asr.audio_info?.duration ?? 0;
	if (durationMs > 0) {
		const audioDurationS = durationMs / 1000;
		emitLog(sessionPath, `[ASR] Audio duration ${audioDurationS.toFixed(1)}s`);
		emitLog(sessionPath, `[ASR] RTF ${(elapsedSec / audioDurationS).toFixed(2)}`);
	}
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



async function asrFasterWhisper(opts: AsrOptions) {
	const { taskId, audioPath, sessionPath: sessionPath, language, device, pythonBin: pyBin, ctx } = opts;
	const asrScript = join(
		REPO_ROOT,
		'packages',
		'cli',
		'scripts',
		'asr',
		'run.py',
	);
	const baseArgs = [asrScript, audioPath, sessionPath, language || 'auto'];

	const useGpu = device !== 'cpu';
	const attempts = useGpu ? 2 : 1;
	let fallbackToCpu = false;

	for (let attempt = 0; attempt < attempts; attempt++) {
		const args = attempt === 0 && useGpu ? baseArgs : [...baseArgs, '--cpu'];
		const t0 = Date.now();
		const result = spawnSync(pyBin, args, {
			maxBuffer: 256 * 1024 * 1024,
			timeout: 600_000,
		});
		const elapsedSec = (Date.now() - t0) / 1000;

		if (result.signal) {
			const stderr = (result.stderr?.toString() || '').trim().slice(-200);
			if (attempt === 0 && useGpu) {
				await setStage(sessionPath, 'asr', {
					last_message: 'GPU hang, retrying CPU...',
				});
				fallbackToCpu = true;
				continue;
			}
			throw new Error(`ASR killed by signal ${result.signal}: ${stderr}`);
		}

		if (result.error)
			throw new Error(`Python ASR subprocess failed: ${result.error.message}`);
		if (result.status !== 0) {
			const stderr = result.stderr?.toString() || '';
			throw new Error(
				`Python ASR exited with status ${result.status}: ${stderr}`,
			);
		}

		const asrOutputPath = parseAsrOutput(result.stdout?.toString() || '');
		if (!asrOutputPath || !existsSync(asrOutputPath)) {
			throw new Error(`Python ASR did not produce output at ${asrOutputPath}`);
		}

		const asr = await readJson(asrOutputPath, ctx);
		const actualDevice = fallbackToCpu ? 'cpu' : useGpu ? 'cuda' : 'cpu';
		if (asr.detected_language) {
			setCtx(sessionPath, {
				asr_language: asr.detected_language,
				runInfo: {
					asr: {
						engine: 'faster-whisper',
						device: actualDevice,
						computeType: actualDevice === 'cpu' ? 'int8' : 'float16',
						gpuAttempted: useGpu,
						fallbackToCpu,
					},
				},
			});
		}
		emitAsrTiming(sessionPath, asr, elapsedSec);

		return;
	}
}
