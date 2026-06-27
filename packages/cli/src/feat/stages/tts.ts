import { spawnSync } from 'node:child_process';
import { readJson, writeFile, ensureDir, writeFileSync } from './utils/fileOps.ts';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeWav } from '@repo/voxlab';
import { VoxCPMEngine } from '../../ml/voxcpm/voxcpm.ts';
import { pythonBin, REPO_ROOT } from '../config/config.ts';
import type { Device, TTSConfig } from '../config/types.ts';
import { emitLog, ffmpeg, nowISO, readTaskLanguages, timingsFilePath } from './utils/utils.ts';
import { TranslateFile } from './translate.ts';
import { Context, setStage, setTask } from '../context/context.ts';
import { startLog } from './utils/log.ts';

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main stage
// ---------------------------------------------------------------------------

export async function stageTts(
	ctx: Context,
) {
	const taskId = ctx.task.id;
	const sessionPath = ctx.task.session_path;
	startLog(sessionPath, taskId);

	const ttsCfg = ctx.input?.stages?.tts!;
	const timingsFile = timingsFilePath(sessionPath);
	const vocalsDir = join(sessionPath, 'split_audio', 'vocals');
	const ttsDir = join(sessionPath, 'tts', 'wavs');
	const doubledDir = resolve(ttsDir, '..', 'ref_doubled');

	if (!existsSync(timingsFile))
		throw new Error(`${timingsFile} not found`);
	ensureDir(ttsDir, ctx);
	ensureDir(doubledDir, ctx);

	const data: TranslateFile = await readJson(timingsFile, ctx);
	const translation = data.translation;
	const total = translation.length;

	if (!ttsCfg.skipExisting) {
		const anyTts = readdirSync(ttsDir).find((f) => f.endsWith('.wav'));
		if (anyTts) {
			emitLog(sessionPath, `[TTS] Existing TTS segments found; will overwrite without deleting files`);
		}
	}

	// ------ Unified engine (handles all runtimes via createBackend) ------

	emitLog(sessionPath, `[TTS] Using ${ttsCfg.runtime} backend`);
	const engine = new VoxCPMEngine(ttsCfg);
	await engine.load();

	// ------ Generation loop ------

	const tqdmStart = Date.now();
	let generated = 0, skipped = 0, errors = 0;
	let genMs = 0;

	// Find fallback reference for segments without usable reference audio
	let fallbackRef = '';
	for (let i = 0; i < total; i++) {
		const idx = String(i + 1).padStart(4, '0');
		const refPath = resolve(vocalsDir, `${idx}.wav`);
		if (existsSync(refPath) && statSync(refPath).size > 1200 * 16 * 2) {
			fallbackRef = refPath;
			break;
		}
	}

	for (let i = 0; i < total; i++) {
		const item = translation[i];
		const idx = String(i + 1).padStart(4, '0');
		const outPath = resolve(ttsDir, `${idx}.wav`);

		let refWav = resolve(vocalsDir, `${idx}.wav`);
		if (!existsSync(refWav) || statSync(refWav).size < 1200 * 16 * 2) {
			refWav = fallbackRef;
		}
		const refMtime = refWav && existsSync(refWav) ? statSync(refWav).mtimeMs : 0;

		if (ttsCfg.skipExisting && existsSync(outPath) && statSync(outPath).mtimeMs > refMtime) {
			skipped += 1;
			renderProgress(i + 1, total, tqdmStart);
			continue;
		}

		const text = item.dst || '';
		if (!text.trim()) {
			writeFile(outPath, Buffer.alloc(44), ctx);
			skipped += 1;
			renderProgress(i + 1, total, tqdmStart);
			continue;
		}

		if (!refWav || !existsSync(refWav)) {
			emitLog(sessionPath, `[WARN] [TTS] No reference for segment ${idx}, skipping`);
			writeFile(outPath, Buffer.alloc(44), ctx);
			skipped += 1;
			renderProgress(i + 1, total, tqdmStart);
			continue;
		}

		// Double reference audio if shorter than 2500ms
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

		setStage(sessionPath, 'tts', {
			last_message: `Generating ${i + 1}/${total}...`,
		});
		renderProgress(i + 1, total, tqdmStart);

		const t1 = performance.now();
		try {
			const samples = await engine.synthesize(text, refWav, item.src);
			genMs += performance.now() - t1;
			writeWav(samples, outPath, 48000);
			generated += 1;
		} catch (e) {
			errors += 1;
			emitLog(sessionPath, `[ERROR] [TTS] Segment ${idx} failed: ${e}`);
			writeFile(outPath, Buffer.alloc(44), ctx);
		}
	}

	await engine.release();
	process.stdout.write('\n');

	const genSec = genMs / 1000;
	const audioSec = translation.reduce((s, t) => s + (t.end_time - t.start_time), 0) / 1000;
	const rtf = audioSec > 0 && genSec > 0 ? genSec / audioSec : 0;

	emitLog(sessionPath, `[TTS] Batch complete: ${generated} generated, ${skipped} skipped, ${errors} errors`);
	emitLog(sessionPath, `[VoxCPM] Generated in ${genSec.toFixed(1)}s | RTF ${rtf.toFixed(3)}`);
	await setStage(sessionPath, 'tts', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
		last_message: 'TTS done',
	});
}
