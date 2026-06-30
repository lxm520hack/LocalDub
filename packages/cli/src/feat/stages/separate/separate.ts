import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { runStage, getTorchServerUrl } from '../../../ml/server/client.ts';
import { Demucs } from '../../../ml/demucs/demucs.ts';
import type { Stem } from '../../../ml/demucs/load.ts';
import { DEMUCS_MODEL_DIR } from '@repo/config/path/models';
import {
	readInputArgs,
} from '../../input/input.ts';
import { emitLog, nowISO, probeDuration, separateDir, videoSourcePath } from '../utils/utils.ts';
import { Context, setStage } from '../../context/context.ts';
import { ensureGgmlModel, tryBuildGgml } from '../../../ml/demucs/separate-build.ts';
import { startLog } from '../utils/log.ts';
import { separateBurn } from '../../../ml/demucs/cli/burn_cli.ts';
import { separateGgml } from '../../../ml/demucs/cli/ggml_cli.ts';
import { pythonBin } from '@repo/config/path/bin';
import { findServer } from '@repo/core/servers/discovery';
import { REPO_ROOT } from '@repo/config/path/root';

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

	const videoPath = ctx.videoSourcePath!
	if (!existsSync(videoPath)) throw new Error('video_source.mp4 not found');
	const audioPath = ctx.audioSourcePath!
	if (!existsSync(audioPath)) throw new Error('audio_source.wav not found');

	const runtime = sepCfg?.runtime ?? 'pytorch';
	const device = sepCfg?.device ?? 'cuda';

	if (runtime === 'pytorch') {
		emitLog(sessionPath, `[Separate] Using Torch server (device=${device})`);

		const {port} = await findServer('torch')
		const sepUrl = getTorchServerUrl(port);
		let lastTorchPct = -1;
		const result = await runStage(sepUrl,
			'separate',
			taskId,
			{
				video_path: audioPath,
				session_path: sessionPath,
				device,
			},
			(current, _total) => {
				if (current === lastTorchPct) return;
				lastTorchPct = current;
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
		await separateGgml(taskId, sessionPath, ctx.audioSourcePath!, device);
	} else if (runtime === 'burn') {
		await separateBurn({ sessionPath, audioPath, device });
	} else if (runtime === 'burn-tch') {
		await separateBurn({ sessionPath, audioPath, device, backend: 'tch' });
	} else if (runtime === 'ort') {
		await separateOrt(taskId, sessionPath, ctx.audioSourcePath!, device);
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
	audioPath: string,
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
		sessionPath,
		'--device',
		device,
	];

	emitLog(sessionPath, `[Separate] runtime=pytorch device=${device}`);

	return new Promise<void>((resolve, reject) => {
		const proc = spawn(pyBin, pythonArgs, {
			env: { ...process.env, TORCHAUDIO_USE_BACKEND: 'soundfile', TORCH_HOME: join(DEMUCS_MODEL_DIR, 'pytorch_hub') } as Record<string, string>,
		});

		let stderr = '';
		let lastPyPct = -1;

		proc.stdout.on('data', (chunk: Buffer) => {
			const lines = chunk.toString().split('\n').filter(Boolean);
			for (const line of lines) {
				const m = line.match(/^\[PROGRESS\] (\d+)$/);
				if (m) {
					const pct = parseInt(m[1]);
					if (pct === lastPyPct) continue;
					lastPyPct = pct;
					setStage(sessionPath, 'separate', {
						progress: pct,
						last_message: `Separating ${pct}%`,
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

