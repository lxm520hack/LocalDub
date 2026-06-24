import { spawn, spawnSync } from 'node:child_process';
import { readJson, writeFile, ensureDir } from './utils/fileOps.ts';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
	writeWav,
} from '@repo/voxlab';
import { VoxCPMEngine } from '../../ml/voxcpm/voxcpm.ts';
import type { MLDaemon } from '../../ml/daemon/client.ts';
import { pythonBin, REPO_ROOT, } from '../config/config.ts';
import type { Device, TTSConfig } from '../config/types.ts';
import { emitLog, ffmpeg, nowISO, readTaskLanguages, timingsFilePath, } from './utils/utils.ts';
import { TranslateFile } from './translate.ts';
import { Context, setStage, setTask } from '../context/context.ts';

async function runPytorchBatch(
	ctx: Context,
	ttsCfg: NonNullable<TTSConfig>,
	translationFile: string,
	vocalsDir: string,
	ttsDir: string,
	total: number,
) {
	const sessionPath = ctx.task.session_path
	const taskId = ctx.task.id
	if (!ttsCfg) throw new Error('TTS config not found');

	const device = 'device' in ttsCfg ? (ttsCfg.device as Device) : 'cuda';
	const scriptPath = join(
		REPO_ROOT,
		'packages',
		'voxlab',
		'scripts',
		'voxcpm_infer_batch.py',
	);
	const modelDir = join(REPO_ROOT, 'data', 'modelscope', 'OpenBMB__VoxCPM2');
	const pyBin = pythonBin();
	const voxcpmSrc = join(REPO_ROOT, 'submodule', 'VoxCPM', 'src');

	const ensureScript = join(REPO_ROOT, 'packages', 'cli', 'scripts', 'ensure_voxcpm.py');
	const procEnsure = spawn(pyBin, [ensureScript, 'OpenBMB/VoxCPM2', modelDir], { timeout: 1_800_000 });
	procEnsure.stderr?.pipe(process.stderr);
	await new Promise<void>((resolve, reject) => {
		procEnsure.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ensure_voxcpm.py exited ${code}`)));
		procEnsure.on('error', reject);
	});

	return new Promise<void>((resolve, reject) => {
		const args = [
			scriptPath,
			'--model-dir', modelDir,
			'--translation-file', translationFile,
			'--vocals-dir', vocalsDir,
			'--tts-dir', ttsDir,
			'--device', device,
		];
		if (ttsCfg.skipExisting) args.push('--skip-existing');
		const proc = spawn(pyBin, args,
			{
				env: { ...process.env, PYTHONPATH: voxcpmSrc },
			},
		);

		let stderr = '';

		proc.stdout.on('data', (chunk: Buffer) => {
			const lines = chunk.toString().split('\n').filter(Boolean);
			for (const line of lines) {
				const progressMatch = line.match(/^\[PROGRESS\] (\d+)\/(\d+)$/);
				if (progressMatch) {
					const current = parseInt(progressMatch[1]);
					const ttl = parseInt(progressMatch[2]);
					setStage(sessionPath, 'tts', {
						last_message: `Generating ${current}/${ttl}...`,
					});
				} else if (line.startsWith('{')) {
					try {
						const result = JSON.parse(line);
						emitLog(
							sessionPath,
							`[TTS] Batch complete: ${result.generated} generated, ${result.skipped} skipped, ${result.errors} errors in ${result.total_time_s}s`,
						);
						if (result.generate_time_s) {
							emitLog(
								sessionPath,
								`[VoxCPM] Generated in ${result.total_time_s}s | RTF ${result.rtf}`,
							);
						}
					} catch {
						/* not JSON */
					}
				}
			}
		});

		proc.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		proc.on('close', (code) => {
			if (code !== 0) {
				const errMsg = stderr.slice(-500);
				reject(new Error(`Python batch TTS exit code ${code}: ${errMsg}`));
				return;
			}
			resolve();
		});

		proc.on('error', reject);
	});
}

export async function stageTts(
	ctx: Context,
	daemon?: MLDaemon,
) {
	const taskId = ctx.task.id;
	const sessionPath = ctx.task.session_path
	setTask(sessionPath, {
		current_stage: 'tts',
	});
	const ttsCfg = ctx.input?.stages?.tts!
	const { targetLanguage: dstLangCode } = readTaskLanguages(ctx);
	const timingsFile = timingsFilePath(sessionPath);
	const vocalsDir = join(sessionPath, 'split_audio', 'vocals');
	const ttsDir = join( sessionPath, 'tts', 'wavs');
	const tmpDir = join( sessionPath, 'tmp');

	if (!existsSync(timingsFile))
		throw new Error(`${timingsFile} not found`);
	ensureDir(ttsDir, ctx);
	ensureDir(tmpDir, ctx);

	const data: TranslateFile = await readJson(timingsFile, ctx);
	const translation = data.translation;

	if (!ttsCfg.skipExisting) {
		const anyTts = readdirSync(ttsDir).find((f) => f.endsWith('.wav'));
		if (anyTts) {
			emitLog(sessionPath, `[TTS] Existing TTS segments found; will overwrite without deleting files`);
			// Do not remove existing files — generation and ffmpeg will overwrite outputs as needed
		}
	}

	if (ttsCfg.runtime === 'pytorch' && daemon) {
		if (!daemon.ready) await daemon.start();
		emitLog(sessionPath, `[TTS] Using Python daemon (device=${ttsCfg.device})`);
		const modelDir = join(REPO_ROOT, 'data', 'modelscope', 'OpenBMB__VoxCPM2');
		const ensureScript = join(REPO_ROOT, 'packages', 'cli', 'scripts', 'ensure_voxcpm.py');
		const procEnsure = spawn(pythonBin(), [ensureScript, 'OpenBMB/VoxCPM2', modelDir], { timeout: 1_800_000 });
		procEnsure.stderr?.pipe(process.stderr);
		await new Promise<void>((resolve, reject) => {
			procEnsure.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ensure_voxcpm.py exited ${code}`)));
			procEnsure.on('error', reject);
		});
		const result = await daemon.runStage(
			'tts',
			taskId,
			{
				translation_file: timingsFile,
				vocals_dir: vocalsDir,
				tts_dir: ttsDir,
				model_dir: modelDir,
				device: ttsCfg.device,
				skipExisting: ttsCfg.skipExisting,
			},
			(current, total) => {
				emitLog(sessionPath, `[TTS] ${current}/${total}`);
				setStage(sessionPath, 'tts', {
					last_message: `Generating ${current}/${total}...`,
				});
			},
		);
		const r = result as Record<string, number>;
		emitLog(
			sessionPath,
			`[TTS] Batch complete: ${r.generated ?? 0} generated, ${r.skipped ?? 0} skipped, ${r.errors ?? 0} errors`,
		);
		if (r.load_time_s)
			emitLog(sessionPath, `[TTS] Model loaded in ${r.load_time_s}s`);
		if (r.generate_time_s)
			emitLog(sessionPath, `[TTS] Generated in ${r.generate_time_s}s`);
		if (r.total_time_s)
			emitLog(sessionPath, `[TTS] Total ${r.total_time_s}s (load + generate)`);
		if (r.rtf != null)
			emitLog(sessionPath, `[VoxCPM] RTF ${r.rtf}`);
		if (r.errors && r.errors > 0)
			emitLog(sessionPath, `[WARN] [TTS] ${r.errors} segments had errors`);
		await setStage(sessionPath, 'tts', {
			status: 'succeeded',
			completed_at: nowISO(),
			progress: 100,
			last_message: 'TTS done',
		});
		return;
	}

	if (ttsCfg.runtime === 'pytorch') {
		await runPytorchBatch(
			ctx,
			ttsCfg,
			timingsFile,
			vocalsDir,
			ttsDir,
			translation.length,
		);
	} else {
		let fallbackRef = '';
		for (let i = 0; i < translation.length; i++) {
			const idx = String(i + 1).padStart(4, '0');
			const refPath = resolve(vocalsDir, `${idx}.wav`);
			if (existsSync(refPath) && statSync(refPath).size > 1200 * 16 * 2) {
				fallbackRef = refPath;
				break;
			}
		}

		const engine = new VoxCPMEngine(ttsCfg);
		await engine.load();

		const t0 = performance.now();
		let genMs = 0;
		for (let i = 0; i < translation.length; i++) {
			const item = translation[i];
			const idx = String(i + 1).padStart(4, '0');
			const outPath = resolve(ttsDir, `${idx}.wav`);

			let refWav = resolve(vocalsDir, `${idx}.wav`);
			if (!existsSync(refWav) || statSync(refWav).size < 1200 * 16 * 2) {
				refWav = fallbackRef;
			}
			const refMtime = refWav && existsSync(refWav) ? statSync(refWav).mtimeMs : 0;

			if (ttsCfg.skipExisting && existsSync(outPath) && statSync(outPath).mtimeMs > refMtime) {
				continue;
			}

			const text = item.dst || '';
			if (!text.trim()) {
				writeFile(outPath, Buffer.alloc(44), ctx);
				continue;
			}

			if (!refWav || !existsSync(refWav)) {
				emitLog(
					sessionPath,
					`[WARN] [TTS] No reference for segment ${idx}, skipping`,
				);
				writeFile(outPath, Buffer.alloc(44), ctx);
				continue;
			}

			const minRefMs = 2500;
			const durProbe = spawnSync('ffprobe',
				['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', refWav],
				{ stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
			);
			const refMs = parseFloat(durProbe.stdout.toString().trim()) * 1000 || 0;
			if (refMs > 0 && refMs < minRefMs) {
				const doubled = resolve(tmpDir, `ref_${idx}_x2.wav`);
				if (!existsSync(doubled)) {
					const listPath = resolve(tmpDir, `ref_${idx}_list.txt`);
					writeFile(listPath, `file '${refWav}'\nfile '${refWav}'`, ctx);
					ffmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', doubled]);
				}
				refWav = doubled;
			}

			setStage(sessionPath, 'tts', {
				last_message: `Generating ${i + 1}/${translation.length}...`,
			});

			const t1 = performance.now();
			const audio = await engine.synthesize(text, refWav, item.src);
			genMs += performance.now() - t1;
			writeWav(audio, outPath, 48000);
		}

		await engine.release();

		const genSec = genMs / 1000;
		const audioSec = translation.reduce((s, t) => s + (t.end_time - t.start_time), 0) / 1000;
		const rtf = audioSec > 0 && genSec > 0 ? genSec / audioSec : 0;
		emitLog(sessionPath, `[VoxCPM] Generated in ${genSec.toFixed(1)}s | RTF ${rtf.toFixed(3)}`);
	}

	await setStage(sessionPath, 'tts', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
		last_message: 'TTS done',
	});
}
