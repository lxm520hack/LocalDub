import { spawnSync } from 'node:child_process';
import { readJson, writeFile, ensureDir, writeFileSync, rmSync } from '@repo/core/utils/fileOps';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeWav } from '@repo/voxlab';

import { emitLog, ffmpeg, nowISO, readTaskLanguages, split_audio_timings_filepath } from '@repo/core/stages/utils/utils.ts';
import { TranslateFile } from '@repo/core/stages/translate';
import { Context, setStage, setTask } from '@repo/core/context/context.ts';
import { startLog } from './utils/log.ts';
import { newVoxCPMEngine } from '@repo/core/ml/voxcpm/voxcpm';


/**
 * Progress bar
 */
function renderProgress(current: number, total: number, start: number) {
	const elapsed = (Date.now() - start) / 1000;
	const frac = total > 0 ? current / total : 0;
	const pct = (frac * 100).toFixed(0).padStart(3);
	const barW = 10;
	const fracW = frac * barW;
	const fill = Math.min(Math.floor(fracW), barW);
	const blockChars = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
	const barFull = '█'.repeat(fill);
	const barRest = fill >= barW ? '' : (blockChars[Math.round((fracW - fill) * 8)] || ' ');
	const barEmpty = fill >= barW ? '' : ' '.repeat(Math.max(0, barW - fill - 1));
	const bar = `${barFull}${barRest}${barEmpty}`;
	const rate = current > 0 ? current / elapsed : 0;
	const eta = total > 0 && rate > 0 ? (total - current) / rate : 0;
	const fmt = (s: number) => {
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
	};
	process.stdout.write(`\r${pct}%|${bar}| ${current}/${total} [${fmt(elapsed)}<${fmt(eta)}, ${rate.toFixed(2)}it/s]`);
}

export async function stageTts(
	ctx: Context,
) {
	const taskId = ctx.task.id;
	const taskDir = ctx.task.session_path;
	startLog(taskDir, taskId);

	const ttsCfg = ctx.input?.stages?.tts!;
	const timingsFile = split_audio_timings_filepath(taskDir);
	const vocalsDir = join(taskDir, 'split_audio', 'vocals');
	const ttsWavDir = join(taskDir, 'tts', 'wavs');
	const doubledDir = join(taskDir, 'tts', 'ref_doubled');

	if (!existsSync(timingsFile))
		throw new Error(`${timingsFile} not found`);
	ensureDir(ttsWavDir, ctx);
	if (ttsCfg.refAudioX2) {ensureDir(doubledDir, ctx);}
	

	const { translation } = await readJson<TranslateFile>(timingsFile, ctx);

	if (!ttsCfg.skipExisting) {
		const anyTts = readdirSync(ttsWavDir).find((f) => f.endsWith('.wav'));
		if (anyTts) {
			emitLog(taskDir, `[tts] Existing TTS segments found; will overwrite without deleting files`);
		}
	}
	// Unified engine (handles all runtimes via createBackend) 

	emitLog(taskDir, `[tts] Using ${ttsCfg.runtime} backend`);
	const engine = newVoxCPMEngine(ttsCfg);
	await engine.load();

	//  Generation loop 
	const tqdmStart = Date.now();
	let generated = 0, skipped = 0, errors = 0;
	let genMs = 0;

	// Find fallback reference for segments without usable reference audio
	/**
	 * 遍历 1 到 translation.length 个 segment 的 vocals 文件（0001.wav ~ 000N.wav），找到第一个非静音的作为 fallbackRef。
	 * existsSync(refPath) && statSync(refPath).size > 1200 * 16 * 2 这个阈值：
	 * - 1200 = 1200 个采样帧（约 75ms @ 16kHz）
	 * - 16 = 16bit 采样深度
	 * - 2 = 双声道
	 * - 即 PCM 裸数据 > 38400 bytes 才认为有实际声音内容
	 * 目的：后面如果有 segment 没有对应的 vocals 文件（或 vocals 太短是静音），就用这个 fallbackRef 作为 TTS 的参考音频输入，避免缺参考音导致 TTS 效果差或报错。
	 */
	const i = translation.findIndex((_, i) => {
		const refPath = join(vocalsDir, `${String(i + 1).padStart(4, '0')}.wav`);
		return existsSync(refPath) && statSync(refPath).size > 1200 * 16 * 2;
	});
	const fallbackRef = i !== -1
		? join(vocalsDir, `${String(i + 1).padStart(4, '0')}.wav`)
		: '';

	const isStart = ctx.input?.task.action === 'start';
	const onlyIndices = isStart ? undefined : ttsCfg.onlyIndices 
	// 真正的 TTS 主循环。i 是 0-based 数组索引，idx = i + 1 是 1-based 文件名（0001.wav ~ 000N.wav）
	for (const [i, item] of translation.entries()) {
		const idx = String(i + 1).padStart(4, '0');
		const outPath = resolve(ttsWavDir, `${idx}.wav`);

		// onlyIndices: 只处理指定索引，同时删除旧文件强制重新生成
		if (onlyIndices?.length) {
			if (!onlyIndices.includes(i + 1)) {
				skipped += 1;
				renderProgress(i + 1, translation.length, tqdmStart);
				continue;
			}
			// 在列表里 删除指定 {idx}.wav 文件
			if (existsSync(outPath)) {
				rmSync(outPath, { force: true });
			}
		}

		let refWav = join(vocalsDir, `${idx}.wav`);
		if (!existsSync(refWav) || statSync(refWav).size < 1200 * 16 * 2) {
			refWav = fallbackRef;
		}
		const refMtime = refWav && existsSync(refWav) ? statSync(refWav).mtimeMs : 0;

		if (ttsCfg.skipExisting && existsSync(outPath) && statSync(outPath).mtimeMs > refMtime) {
			skipped += 1;
			renderProgress(i + 1, translation.length, tqdmStart);
			continue;
		}

		const text = item.dst || '';
		if (!text.trim()) {
			writeFile(outPath, Buffer.alloc(44), ctx);
			skipped += 1;
			renderProgress(i + 1, translation.length, tqdmStart);
			continue;
		}

		if (!refWav || !existsSync(refWav)) {
			emitLog(taskDir, `[WARN] [TTS] No reference for segment ${idx}, skipping`);
			writeFile(outPath, Buffer.alloc(44), ctx);
			skipped += 1;
			renderProgress(i + 1, translation.length, tqdmStart);
			continue;
		}

		// Double reference audio if shorter than 2500ms
		if (ttsCfg.refAudioX2) {
			const minRefMs = 2500;
			const durProbe = spawnSync('ffprobe',
				['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', refWav],
				{ stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
			);
			const refMs = parseFloat(durProbe.stdout.toString().trim()) * 1000 || 0;
			if (refMs > 0 && refMs < minRefMs) {
				const doubled = resolve(doubledDir, `ref_${idx}_x2.wav`);
				if (!existsSync(doubled)) {
					const listPath = resolve(doubledDir, `ref_${idx}_list.txt`);
					writeFileSync(listPath, `file '${refWav}'\nfile '${refWav}'`);
					ffmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', doubled]);
				}
				refWav = doubled;
			}
		}

		setStage(taskDir, 'tts', {
			last_message: `Generating ${i + 1}/${translation.length}...`,
		});
		renderProgress(i + 1, translation.length, tqdmStart);

		const t1 = performance.now();
		try {
			const samples = await engine.synthesize(text, refWav, item.src);
			genMs += performance.now() - t1;
			writeWav(samples, outPath, 48000);
			generated += 1;
		} catch (e) {
			errors += 1;
			emitLog(taskDir, `[tts] [ERROR] Segment ${idx} failed: ${JSON.stringify(e)}`);
			writeFile(outPath, Buffer.alloc(44), ctx);
		}
	}

	await engine.release();
	process.stdout.write('\n');

	const genSec = genMs / 1000;
	const audioSec = translation.reduce((s, t) => s + (t.end_time - t.start_time), 0) / 1000;
	const rtf = audioSec > 0 && genSec > 0 ? genSec / audioSec : 0;

	emitLog(taskDir, `[TTS] Batch complete: ${generated} generated, ${skipped} skipped, ${errors} errors`);
	emitLog(taskDir, `[VoxCPM] Generated in ${genSec.toFixed(1)}s | RTF ${rtf.toFixed(3)}`);
	await setStage(taskDir, 'tts', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
		last_message: 'TTS done',
	});
}
