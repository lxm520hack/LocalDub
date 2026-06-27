import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runStage, getTorchServerUrl } from '../../../ml/server/client.ts';
import { Demucs } from '../../../ml/demucs/demucs.ts';
import type { Stem } from '../../../ml/demucs/load.ts';
import {
	pythonBin,
	REPO_ROOT,
	readInputArgs,
} from '../../config/config.ts';
import { emitLog, nowISO, probeDuration, separateDir, videoSourcePath } from '../utils/utils.ts';
import { Context, setStage } from '../../context/context.ts';
import { ensureGgmlModel, tryBuildGgml } from '../../../ml/demucs/separate-build.ts';
import { startLog } from '../utils/log.ts';

export async function stageSeparate(
	ctx: Context,
) {
	startLog('separate', ctx.task.id);
	const taskId = ctx.task.id;
	const sessionPath = ctx.task.session_path;
	// subtitle 模式且未配置 always 时，跳过分离
	const pipeline = ctx?.pipeline || 'dub';
	const sepCfg = ctx.input?.stages?.separate;
	if (pipeline === 'subtitle' && !sepCfg?.always) {
		emitLog(
			sessionPath,
			'[Separate] Skipped (subtitle pipeline, set separate.always=true to force)',
		);
		await setStage(sessionPath, 'separate', {
			status: 'succeeded',
			completed_at: nowISO(),
			progress: 100,
			last_message: 'Skipped (subtitle pipeline)',
		});
		return;
	}

	await setStage(sessionPath, 'separate', {
		last_message: 'Separating audio...',
		progress: 0,
	});

	const videoPath = videoSourcePath(sessionPath);
	if (!existsSync(videoPath)) throw new Error('video_source.mp4 not found');

	const runtime = sepCfg?.runtime ?? 'pytorch';
	const device = sepCfg?.device ?? 'cuda';

	if (runtime === 'pytorch') {
		emitLog(sessionPath, `[Separate] Using Torch server (device=${device})`);
		const absVideo = resolve(
			REPO_ROOT,
			sessionPath,
			'download',
			'video_source.mp4',
		);
		const sepUrl = getTorchServerUrl(ctx.input?.torchServer?.port ?? 19109);
		const result = await runStage(sepUrl,
			'separate',
			taskId,
			{
				video_path: absVideo,
				session_path: sessionPath,
				device,
			},
			(current, _total) => {
				emitLog(sessionPath, `[Separate] ${current}%`);
				setStage(sessionPath, 'separate', {
					progress: current,
					last_message: `Separating ${current}%...`,
				});
			},
			(line) => process.stderr.write(line + '\n'),
		);
		const sr = result as Record<string, number>;
		if (sr.load_time_s)
			emitLog(sessionPath, `[Separate] Model loaded in ${sr.load_time_s}s`);
		if (sr.process_time_s)
			emitLog(sessionPath, `[Separate] Processed in ${sr.process_time_s}s`);
		if (sr.audio_duration_s)
			emitLog(
				sessionPath,
				`[Separate] Audio duration ${sr.audio_duration_s.toFixed(1)}s`,
			);
		if (sr.rtf) emitLog(sessionPath, `[Separate] RTF ${sr.rtf}`);
	} else if (runtime === 'ggml') {
		await separateGgml(taskId, sessionPath, videoPath, device);
	} else {
		await separateOrt(taskId, sessionPath, videoPath, device);
	}

	await setStage(sessionPath, 'separate', {
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
	const sepCfg = readInputArgs().stages?.separate;
	const targetStems: Stem[] = sepCfg && 'stems' in sepCfg ? (sepCfg as { stems?: Stem[] }).stems ?? ['vocals'] : ['vocals'];
	emitLog(
		sessionPath,
		`[Separate] runtime=ort device=${device} stems=${targetStems.join(',')} → ONNX session(${ep})`,
	);

	const demucs = new Demucs(undefined, { executionProvider: ep, stems: targetStems });
	await demucs.load();

	const audioPath = join(sessionPath, 'download', 'audio_source.wav');
	if (!existsSync(audioPath)) throw new Error('audio_source.wav not found (run download stage)');

	const t0 = performance.now();
	const stems = await demucs.separate(audioPath);
	const elapsedSec = (performance.now() - t0) / 1000;

	emitLog(sessionPath, `[Separate] Processed in ${elapsedSec.toFixed(1)}s`);
	const audioDurationS = stems.vocals.length / 88200;
	emitLog(sessionPath, `[Separate] RTF ${(elapsedSec / audioDurationS).toFixed(2)}`);

	const sepDir = separateDir(sessionPath);
	const stemNames = ['drums', 'bass', 'other', 'vocals'] as const;
	for (let i = 0; i < stemNames.length; i++) {
		demucs.writeWav(
			stems[stemNames[i]],
			stems.sampleRate,
			join(sepDir, `target_${i}_${stemNames[i]}.wav`),
		);
	}
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
		'src',
		'ml',
		'demucs',
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

	emitLog(sessionPath, `[Separate] runtime=pytorch device=${device}`);

	return new Promise<void>((resolve, reject) => {
		const proc = spawn(pyBin, pythonArgs, {
			env: { ...process.env, TORCHAUDIO_USE_BACKEND: 'soundfile' } as Record<string, string>,
		});

		let stderr = '';

		proc.stdout.on('data', (chunk: Buffer) => {
			const lines = chunk.toString().split('\n').filter(Boolean);
			for (const line of lines) {
				const m = line.match(/^\[PROGRESS\] (\d+)$/);
				if (m) {
					setStage(sessionPath, 'separate', {
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
	const sepDir = separateDir(sessionPath);
	mkdirSync(sepDir, { recursive: true });

	emitLog(sessionPath, `[Separate] runtime=ggml device=${device} binary=${ggmlBin}`);

	// Extract audio to WAV
	const audioPath = join(sessionPath, 'download', 'audio_source.wav');
	if (!existsSync(audioPath)) throw new Error('audio_source.wav not found (run download stage)');

	const isWin = process.platform === 'win32';
	const ggmlBinPath = isWin && !ggmlBin.endsWith('.exe') ? `${ggmlBin}.exe` : ggmlBin;

	if (!existsSync(ggmlBinPath)) {
		emitLog(sessionPath, `[Separate] Binary not found at ${ggmlBinPath}, attempting auto-build...`);
		const built = await tryBuildGgml(sessionPath);
		if (!built) {
			throw new Error(
				`GGML binary not found at ${ggmlBinPath}\n`
				+ `Auto-build failed. To build manually:\n`
				+ `  1. git submodule update --init submodule/demucs.cpp\n`
				+ `  2. cd submodule/demucs.cpp && mkdir build && cd build\n`
				+ `  3. cmake .. && cmake --build . --config Release -j4\n`
				+ `Or set separate.runtime to "ort" or "pytorch" in config to use ONNX or Python instead.`,
			);
		}
		emitLog(sessionPath, `[Separate] Auto-build succeeded`);
	}

	if (!existsSync(ggmlModel)) {
		await ensureGgmlModel(sessionPath, ggmlModel);
	}

	const t0 = performance.now();
	await new Promise<void>((resolve, reject) => {
		const proc = spawn(ggmlBinPath, [ggmlModel, audioPath, sepDir, '4'], {
			env: { ...process.env, OMP_NUM_THREADS: '2' },
		});
		let stderr = '';
		const hung = setTimeout(() => {
			proc.kill('SIGKILL');
			reject(new Error('GGML separate timed out after 600s'));
		}, 600_000);

		proc.stdout?.on('data', (chunk) => {
			const lines = chunk.toString().split('\n');
			for (const line of lines) {
				const m = line.match(/\((\s*\d+(?:\.\d+)?)%\)/);
				if (m) {
					const pct = Math.min(100, Math.max(0, Math.round(Number(m[1]))));
					setStage(sessionPath, 'separate', {
						progress: pct,
						last_message: `Separating ${pct}%`,
					});
				}
			}
		});

		proc.stderr?.on('data', (chunk) => {
			stderr += chunk.toString();
		});

		proc.on('error', (e) => {
			clearTimeout(hung);
			reject(new Error(`GGML separate failed to spawn: ${e.message}`));
		});

		proc.on('close', (code) => {
			clearTimeout(hung);
			if (code === 0) resolve();
			else reject(new Error(`GGML separate failed (${code}): ${stderr.slice(-300)}`));
		});
	});
	const elapsedSec = (performance.now() - t0) / 1000;

	emitLog(sessionPath, `[Separate] Processed in ${elapsedSec.toFixed(1)}s`);

	const stemNames = ['drums', 'bass', 'other', 'vocals'] as const;
	for (const name of stemNames) {
		const p = join(sepDir, `target_${stemNames.indexOf(name)}_${name}.wav`);
		if (!existsSync(p)) {
			emitLog(sessionPath, `[Separate] WARN: ${p} not found`);
		}
	}

	const durationS = probeDuration(audioPath);
	if (durationS > 0) {
		emitLog(sessionPath, `[Separate] RTF ${(elapsedSec / durationS).toFixed(3)}`);
	}
}