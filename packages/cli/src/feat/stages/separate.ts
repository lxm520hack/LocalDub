import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { MLDaemon } from '../../ml/daemon/client.ts';
import { Demucs } from './../../ml/demucs/demucs.ts';
import type { Stem } from '../../ml/demucs/load.ts';
import {
	pythonBin,
	REPO_ROOT,
	readConfig,
	readLocalInfo,
} from '../config/config.ts';
import { emitLog, ffmpeg, nowISO, updateStageDB } from './utils.ts';

export async function stageSeparate(
	taskId: string,
	sessionPath: string,
	daemon?: MLDaemon,
) {
	// subtitle 模式且未配置 always 时，跳过分离
	const pipeline = readLocalInfo(sessionPath)?.pipeline || 'dub';
	const sepCfg = readConfig().stages?.separate;
	if (pipeline === 'subtitle' && !sepCfg?.always) {
		emitLog(
			taskId,
			'[Separate] Skipped (subtitle pipeline, set separate.always=true to force)',
		);
		await updateStageDB(taskId, 'separate', {
			status: 'succeeded',
			completed_at: nowISO(),
			progress: 100,
			last_message: 'Skipped (subtitle pipeline)',
		});
		return;
	}

	await updateStageDB(taskId, 'separate', {
		last_message: 'Separating audio...',
		progress: 0,
	});

	const videoPath = join(sessionPath, 'media', 'video_source.mp4');
	if (!existsSync(videoPath)) throw new Error('video_source.mp4 not found');

	const runtime = sepCfg?.runtime ?? 'pytorch';
	const device = sepCfg?.device ?? 'cuda';

	if (runtime === 'pytorch' && daemon?.ready) {
		emitLog(taskId, `[Separate] Using Python daemon (device=${device})`);
		const absSession = resolve(REPO_ROOT, sessionPath);
		const absVideo = resolve(
			REPO_ROOT,
			sessionPath,
			'media',
			'video_source.mp4',
		);
		const result = await daemon.runStage(
			'separate',
			taskId,
			{
				video_path: absVideo,
				session_path: absSession,
				device,
			},
			(current, _total) => {
				emitLog(taskId, `[Separate] ${current}%`);
				updateStageDB(taskId, 'separate', {
					progress: current,
					last_message: `Separating ${current}%...`,
				});
			},
		);
		const sr = result as Record<string, number>;
		if (sr.load_time_s)
			emitLog(taskId, `[Separate] Model loaded in ${sr.load_time_s}s`);
		if (sr.process_time_s)
			emitLog(taskId, `[Separate] Processed in ${sr.process_time_s}s`);
		if (sr.audio_duration_s)
			emitLog(
				taskId,
				`[Separate] Audio duration ${sr.audio_duration_s.toFixed(1)}s`,
			);
		if (sr.rtf) emitLog(taskId, `[Separate] RTF ${sr.rtf}`);
	} else if (runtime === 'pytorch') {
		await separatePytorch(taskId, sessionPath, videoPath, device);
	} else if (runtime === 'ggml') {
		await separateGgml(taskId, sessionPath, videoPath, device);
	} else {
		await separateOrt(taskId, sessionPath, videoPath, device);
	}

	await updateStageDB(taskId, 'separate', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
		last_message: 'Separated',
	});
}

async function separateOrt(
	taskId: string,
	sessionPath: string,
	videoPath: string,
	device: string,
) {
	const ep = device === 'webgpu' ? 'webgpu' : 'cpu';
	const sepCfg = readConfig().stages?.separate;
	const targetStems: Stem[] = sepCfg && 'stems' in sepCfg ? (sepCfg as { stems?: Stem[] }).stems ?? ['vocals'] : ['vocals'];
	emitLog(
		taskId,
		`[Separate] runtime=ort device=${device} stems=${targetStems.join(',')} → ONNX session(${ep})`,
	);

	const demucs = new Demucs(undefined, { executionProvider: ep, stems: targetStems });
	await demucs.load();

	const audioPath = join(sessionPath, 'tmp', 'audio_source.wav');
	mkdirSync(dirname(audioPath), { recursive: true });
	ffmpeg([
		'-i',
		videoPath,
		'-acodec',
		'pcm_s16le',
		'-ar',
		'44100',
		'-ac',
		'2',
		audioPath,
	]);

	const t0 = performance.now();
	const stems = await demucs.separate(audioPath);
	const elapsedSec = (performance.now() - t0) / 1000;

	emitLog(taskId, `[Separate] Processed in ${elapsedSec.toFixed(1)}s`);
	const audioDurationS = stems.vocals.length / 88200;
	emitLog(taskId, `[Separate] RTF ${(elapsedSec / audioDurationS).toFixed(2)}`);

	const mediaDir = join(sessionPath, 'media');
	const stemNames = ['drums', 'bass', 'other', 'vocals'] as const;
	for (let i = 0; i < stemNames.length; i++) {
		demucs.writeWav(
			stems[stemNames[i]],
			stems.sampleRate,
			join(mediaDir, `target_${i}_${stemNames[i]}.wav`),
		);
	}

	const bgm = new Float32Array(stems.drums.length);
	for (let i = 0; i < bgm.length; i++) {
		bgm[i] = stems.drums[i] + stems.bass[i] + stems.other[i];
	}
	demucs.writeWav(bgm, stems.sampleRate, join(mediaDir, 'target_bgm.wav'));
}

async function separatePytorch(
	taskId: string,
	sessionPath: string,
	videoPath: string,
	device: string,
) {
	const scriptPath = join(
		REPO_ROOT,
		'packages',
		'cli',
		'scripts',
		'separate',
		'run.py',
	);
	const pyBin = pythonBin();
	const pythonArgs = [
		scriptPath,
		videoPath,
		resolve(REPO_ROOT, sessionPath),
		'--device',
		device,
	];

	emitLog(taskId, `[Separate] runtime=pytorch device=${device}`);

	return new Promise<void>((resolve, reject) => {
		const proc = spawn(pyBin, pythonArgs);

		let stderr = '';

		proc.stdout.on('data', (chunk: Buffer) => {
			const lines = chunk.toString().split('\n').filter(Boolean);
			for (const line of lines) {
				const m = line.match(/^\[PROGRESS\] (\d+)$/);
				if (m) {
					updateStageDB(taskId, 'separate', {
						progress: parseInt(m[1]),
						last_message: `Separating ${m[1]}%`,
					});
				}
			}
		});

		proc.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		proc.on('close', (code) => {
			if (code !== 0) {
				reject(
					new Error(`Demucs Python exit code ${code}: ${stderr.slice(-500)}`),
				);
				return;
			}
			resolve();
		});

		proc.on('error', reject);
	});
}

async function separateGgml(
	taskId: string,
	sessionPath: string,
	videoPath: string,
	device: string,
) {
	const ggmlBin = join(
		REPO_ROOT, 'submodule', 'demucs.cpp', 'build', 'demucs_mt.cpp.main',
	);
	const ggmlModel = join(
		REPO_ROOT, 'packages', 'tmp', 'demucs-ggml', 'ggml-model-htdemucs-4s-f16.bin',
	);
	const outDir = resolve(REPO_ROOT, sessionPath, 'tmp', 'ggml-separate');
	mkdirSync(outDir, { recursive: true });

	emitLog(taskId, `[Separate] runtime=ggml device=${device} binary=${ggmlBin}`);

	// Extract audio to WAV
	const audioPath = resolve(REPO_ROOT, sessionPath, 'tmp', 'audio_source.wav');
	mkdirSync(dirname(audioPath), { recursive: true });
	const ffmpegResult = spawnSync('ffmpeg', [
		'-y', '-i', videoPath, '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', audioPath,
	]);
	if (ffmpegResult.status !== 0) {
		throw new Error(`ffmpeg extract failed: ${ffmpegResult.stderr?.toString().slice(-200)}`);
	}

	const t0 = performance.now();
	const result = spawnSync(ggmlBin, [ggmlModel, audioPath, outDir, '4'], {
		timeout: 600_000,
		env: { ...process.env, OMP_NUM_THREADS: '2' },
	});
	const elapsedSec = (performance.now() - t0) / 1000;

	if (result.status !== 0) {
		throw new Error(`GGML separate failed (${result.status}): ${result.stderr?.toString().slice(-300)}`);
	}

	emitLog(taskId, `[Separate] Processed in ${elapsedSec.toFixed(1)}s`);

	// Copy output WAVs to media/
	const mediaDir = resolve(REPO_ROOT, sessionPath, 'media');
	mkdirSync(mediaDir, { recursive: true });
	const stemNames = ['drums', 'bass', 'other', 'vocals'] as const;
	for (let i = 0; i < stemNames.length; i++) {
		const src = join(outDir, `target_${i}_${stemNames[i]}.wav`);
		const dst = join(mediaDir, `target_${i}_${stemNames[i]}.wav`);
		if (existsSync(src)) {
			copyFileSync(src, dst);
		} else {
			emitLog(taskId, `[Separate] WARN: ${src} not found`);
		}
	}

	// BGM = sum of drums+bass+other
	const bgmSrc = join(outDir, 'target_bgm.wav');
	const bgmDst = join(mediaDir, 'target_bgm.wav');
	if (existsSync(bgmSrc)) {
		copyFileSync(bgmSrc, bgmDst);
	} else {
		// Generate bgm via ffmpeg mix if not produced by GGML
		const bgmInputs = stemNames.slice(0, 3).map(s => join(mediaDir, `target_${stemNames.indexOf(s)}_${s}.wav`));
		const filter = `[0:a][1:a][2:a]amix=inputs=3:duration=first[out]`;
		spawnSync('ffmpeg', [
			'-i', bgmInputs[0], '-i', bgmInputs[1], '-i', bgmInputs[2],
			'-filter_complex', filter, '-map', '[out]', '-y', bgmDst,
		]);
	}

	// Cleanup tmp
	rmSync(outDir, { recursive: true, force: true });

	const durationS = (() => {
		try {
			const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audioPath], { timeout: 10_000 });
			return r.status === 0 ? parseFloat(r.stdout.toString().trim()) : 0;
		} catch { return 0; }
	})();
	if (durationS > 0) {
		emitLog(taskId, `[Separate] RTF ${(elapsedSec / durationS).toFixed(3)}`);
	}
}
