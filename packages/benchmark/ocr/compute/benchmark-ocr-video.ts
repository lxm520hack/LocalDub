import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createSessions, ocrFrameWithSessions, releaseSessions } from './ocr_node.ts';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const VIDEOS_PATH = join(REPO_ROOT, 'packages', 'benchmark', 'ref', 'media');
const VIDEO_PATH = join(VIDEOS_PATH, 'video_source.mp4');
const PYTHON_BIN = join(REPO_ROOT, '.venv', 'bin', 'python');
const OCR_PY = resolve(__dirname, 'ocr_frame.py');
const WER_PY = resolve(REPO_ROOT, 'packages', 'benchmark', 'separate', 'compute', 'wer.py');
const GROUND_TRUTH = resolve(REPO_ROOT, 'packages', 'benchmark', 'ref', 'metadata', 'srt_manual.json');
const RESULTS_BASE = resolve(__dirname, '..', 'results');
const TMP = resolve(REPO_ROOT, 'packages', 'tmp', 'ocr-bench');

interface OCRLine {
	text: string;
	confidence: number;
}

interface OCRResult {
	lines: OCRLine[];
	inferenceMs: number;
}

interface Segment {
	text: string;
	start: number;
	end: number;
}

function framesDir(label: string): string {
	return join(TMP, `frames-${label}`);
}

function ocrFramePython(framePath: string, textScore?: number, fullFrame?: boolean, subtitleOnly?: boolean): OCRResult {
	const args = [OCR_PY, framePath];
	if (fullFrame) args.push('--full-frame');
	if (subtitleOnly) args.push('--subtitle-only');
	if (textScore != null) args.push('--text-score', String(textScore));
	const r = spawnSync(PYTHON_BIN, args, {
		timeout: 60_000,
		encoding: 'utf-8',
	});
	if (r.status !== 0) {
		console.error(`  OCR warn: exit ${r.status} for ${framePath}`);
		return { lines: [], inferenceMs: 0 };
	}
	const parsed = JSON.parse(r.stdout);
	if (parsed.error) {
		console.error(`  OCR error: ${parsed.error}`);
		return { lines: [], inferenceMs: 0 };
	}
	if (parsed.lines !== undefined) {
		return {
			lines: parsed.lines.map((l: any) => ({ text: l.text, confidence: l.confidence })),
			inferenceMs: parsed.inference_ms ?? 0,
		};
	}
	return { lines: parsed.map((l: any) => ({ text: l.text, confidence: l.confidence })), inferenceMs: 0 };
}

function extractFrames(videoPath: string, outDir: string, fps: number = 1): number {
	mkdirSync(outDir, { recursive: true });
	const probe = spawnSync('ffprobe', [
		'-v', 'error', '-show_entries', 'format=duration',
		'-of', 'csv=p=0', videoPath,
	], { timeout: 15_000, encoding: 'utf-8' });
	const duration = parseFloat(probe.stdout?.trim() || '0');
	if (!duration) throw new Error('Could not probe video duration');

	const r = spawnSync('ffmpeg', [
		'-y', '-i', videoPath,
		'-vf', `fps=${fps}`,
		'-qscale:v', '2',
		join(outDir, 'frame_%05d.jpg'),
	], { timeout: 300_000 });
	if (r.status !== 0) {
		throw new Error(`ffmpeg frame extraction failed: ${r.stderr?.toString().slice(-200)}`);
	}

	return Math.ceil(duration);
}

function mergeFrames(frames: { text: string; timestamp: number; confidence: number }[]): Segment[] {
	const segments: Segment[] = [];
	let currentText = '';
	let currentStart = 0;

	for (const f of frames) {
		if (!f.text) continue;
		if (f.text !== currentText) {
			if (currentText) {
				segments.push({
					text: currentText,
					start: currentStart,
					end: f.timestamp,
				});
			}
			currentText = f.text;
			currentStart = f.timestamp;
		}
	}
	if (currentText) {
		segments.push({
			text: currentText,
			start: currentStart,
			end: frames[frames.length - 1].timestamp,
		});
	}

	return segments.filter(s => s.end - s.start >= 0.5);
}

function runOCRBenchmarkPython(label: string, fps: number, textScore?: number, subtitleOnly?: boolean) {
	const outDir = join(RESULTS_BASE, label);
	const metadataDir = join(outDir, 'metadata');
	mkdirSync(metadataDir, { recursive: true });
	const frameDir = framesDir(label);

	if (!existsSync(VIDEO_PATH)) throw new Error(`Video not found: ${VIDEO_PATH}`);

	console.log(`\n=== OCR Benchmark: ${label} (fps=${fps}, engine=python) ===`);

	console.log(`  extracting frames at ${fps}fps...`);
	const durationS = extractFrames(VIDEO_PATH, frameDir, fps);

	console.log(`  OCR'ing frames (${durationS}s @ ${fps}fps ≈ ${Math.ceil(durationS * fps)} frames)...`);
	const frameFiles = spawnSync('ls', [frameDir], { encoding: 'utf-8' })
		.stdout.trim().split('\n')
		.filter(f => f.endsWith('.jpg'))
		.sort();

	const frameResults: { text: string; timestamp: number; confidence: number }[] = [];
	let ocrInferenceS = 0;
	for (let i = 0; i < frameFiles.length; i++) {
		const f = frameFiles[i];
		const framePath = join(frameDir, f);
		const timestamp = i / fps;
		const ocrResult = ocrFramePython(framePath, textScore, undefined, subtitleOnly);
		ocrInferenceS += ocrResult.inferenceMs / 1000;
		const best = ocrResult.lines.reduce((a, b) => a.confidence > b.confidence ? a : b, { text: '', confidence: 0 });
		frameResults.push({
			text: best.text,
			timestamp: parseFloat(timestamp.toFixed(2)),
			confidence: best.confidence,
		});
		if ((i + 1) % 100 === 0) console.log(`  OCR: ${i + 1}/${frameFiles.length}`);
	}

	const segments = mergeFrames(frameResults);
	console.log(`  merged ${frameResults.length} frames → ${segments.length} segments`);

	const text = segments.map(s => s.text).join('');
	const audioDur = segments.length > 0 ? segments[segments.length - 1].end : durationS;

	const asrOutput = {
		audio_info: { duration: audioDur * 1000 },
		result: { text, segments },
		_engine: 'rapidocr-onnxruntime',
		_source: 'video_hardsub',
		_fps: fps,
		_textScore: textScore ?? 0.5,
		_subtitleOnly: subtitleOnly ?? false,
	};
	const asrPath = join(metadataDir, 'asr.json');
	writeFileSync(asrPath, JSON.stringify(asrOutput, null, 2));

	const cerResult = spawnSync(PYTHON_BIN, [WER_PY, GROUND_TRUTH, asrPath], {
		timeout: 30_000,
		encoding: 'utf-8',
		env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
	});
	let cerData: any = {};
	if (cerResult.status === 0) {
		cerData = JSON.parse(cerResult.stdout);
	}

	const summary = {
		label,
		fps,
		engine: 'python',
		frames: frameResults.length,
		segments: segments.length,
		audio_duration_s: parseFloat(audioDur.toFixed(1)),
		ocr_inference_s: parseFloat(ocrInferenceS.toFixed(3)),
		ocr_rtf: parseFloat((ocrInferenceS / audioDur).toFixed(4)),
		wer: cerData.wer ?? 0,
		cer: cerData.cer ?? 0,
		hyp_chars: cerData.hyp_chars ?? text.length,
		ref_chars: cerData.ref_chars ?? 0,
		textScore: textScore ?? 0.5,
		subtitleOnly: subtitleOnly ?? false,
	};
	writeFileSync(join(metadataDir, 'summary.json'), JSON.stringify(summary, null, 2));

	console.log(`  segs=${segments.length} dur=${audioDur.toFixed(1)}s`);
	console.log(`  OCR inf=${ocrInferenceS.toFixed(1)}s RTF=${(ocrInferenceS / audioDur).toFixed(4)}`);
	console.log(`  WER=${(cerData.wer * 100).toFixed(2)}% CER=${(cerData.cer * 100).toFixed(2)}%`);
	console.log(`  hyp_chars=${cerData.hyp_chars} ref_chars=${cerData.ref_chars}`);

	spawnSync('rm', ['-rf', frameDir]);

	return summary;
}

async function runOCRBenchmarkNode(label: string, fps: number, textScore?: number, subtitleOnly?: boolean) {
	const outDir = join(RESULTS_BASE, label);
	const metadataDir = join(outDir, 'metadata');
	mkdirSync(metadataDir, { recursive: true });
	const frameDir = framesDir(label);

	if (!existsSync(VIDEO_PATH)) throw new Error(`Video not found: ${VIDEO_PATH}`);

	console.log(`\n=== OCR Benchmark: ${label} (fps=${fps}, engine=node) ===`);

	console.log(`  extracting frames at ${fps}fps...`);
	const durationS = extractFrames(VIDEO_PATH, frameDir, fps);

	console.log(`  OCR'ing frames (${durationS}s @ ${fps}fps ≈ ${Math.ceil(durationS * fps)} frames)...`);
	const frameFiles = spawnSync('ls', [frameDir], { encoding: 'utf-8' })
		.stdout.trim().split('\n')
		.filter(f => f.endsWith('.jpg'))
		.sort();

	// Create sessions once
	console.log('  creating ORT sessions...');
	const sessions = await createSessions('cpu');

	const frameResults: { text: string; timestamp: number; confidence: number }[] = [];
	let ocrInferenceS = 0;
	for (let i = 0; i < frameFiles.length; i++) {
		const f = frameFiles[i];
		const framePath = join(frameDir, f);
		const timestamp = i / fps;
		const result = await ocrFrameWithSessions(framePath, sessions, { textScore, subtitleOnly });
		ocrInferenceS += result.totalMs / 1000;
		const best = result.segments.length > 0
			? result.segments.reduce((a, b) => a.confidence > b.confidence ? a : b)
			: { text: '', confidence: 0 };
		frameResults.push({
			text: result.text || '',
			timestamp: parseFloat(timestamp.toFixed(2)),
			confidence: best.confidence,
		});
		if ((i + 1) % 50 === 0) console.log(`  OCR: ${i + 1}/${frameFiles.length}`);
	}

	await releaseSessions(sessions);

	const segments = mergeFrames(frameResults);
	console.log(`  merged ${frameResults.length} frames → ${segments.length} segments`);

	const text = segments.map(s => s.text).join('');
	const audioDur = segments.length > 0 ? segments[segments.length - 1].end : durationS;

	const asrOutput = {
		audio_info: { duration: audioDur * 1000 },
		result: { text, segments },
		_engine: 'ocr-node',
		_source: 'video_hardsub',
		_fps: fps,
		_textScore: textScore ?? 0.5,
		_subtitleOnly: subtitleOnly ?? false,
	};
	const asrPath = join(metadataDir, 'asr.json');
	writeFileSync(asrPath, JSON.stringify(asrOutput, null, 2));

	const cerResult = spawnSync(PYTHON_BIN, [WER_PY, GROUND_TRUTH, asrPath], {
		timeout: 30_000,
		encoding: 'utf-8',
		env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
	});
	let cerData: any = {};
	if (cerResult.status === 0) {
		cerData = JSON.parse(cerResult.stdout);
	}

	const summary = {
		label,
		fps,
		engine: 'node',
		frames: frameResults.length,
		segments: segments.length,
		audio_duration_s: parseFloat(audioDur.toFixed(1)),
		ocr_inference_s: parseFloat(ocrInferenceS.toFixed(3)),
		ocr_rtf: parseFloat((ocrInferenceS / audioDur).toFixed(4)),
		wer: cerData.wer ?? 0,
		cer: cerData.cer ?? 0,
		hyp_chars: cerData.hyp_chars ?? text.length,
		ref_chars: cerData.ref_chars ?? 0,
		textScore: textScore ?? 0.5,
		subtitleOnly: subtitleOnly ?? false,
	};
	writeFileSync(join(metadataDir, 'summary.json'), JSON.stringify(summary, null, 2));

	console.log(`  segs=${segments.length} dur=${audioDur.toFixed(1)}s`);
	console.log(`  OCR inf=${ocrInferenceS.toFixed(1)}s RTF=${(ocrInferenceS / audioDur).toFixed(4)}`);
	console.log(`  WER=${(cerData.wer * 100).toFixed(2)}% CER=${(cerData.cer * 100).toFixed(2)}%`);
	console.log(`  hyp_chars=${cerData.hyp_chars} ref_chars=${cerData.ref_chars}`);

	spawnSync('rm', ['-rf', frameDir]);

	return summary;
}

// --- Main ---
if (require.main === module) {
	const engine = process.argv.includes('--engine') ? process.argv[process.argv.indexOf('--engine') + 1] : 'python';
	console.log(`Engine: ${engine}`);

	async function main() {
		const fpsOptions: { fps: number; textScore?: number; subtitleOnly?: boolean }[] = [
			{ fps: 1, subtitleOnly: true },
		];
		const results: any[] = [];

		for (const opt of fpsOptions) {
			const label = `ocr-node-fps${opt.fps}${opt.textScore != null ? `-ts${opt.textScore}` : ''}${opt.subtitleOnly ? '-so' : ''}`;
			const summaryPath = join(RESULTS_BASE, label, 'metadata', 'summary.json');
			if (existsSync(summaryPath)) {
				console.log(`[skip] ${label} already done`);
				results.push(JSON.parse(readFileSync(summaryPath, 'utf-8')));
				continue;
			}
			const r = await runOCRBenchmarkNode(label, opt.fps, opt.textScore, opt.subtitleOnly);
			results.push(r);
		}

		console.log('\n======= OCR BENCHMARK SUMMARY =======');
		console.log('label           | fps | ts   | sz  | eng   | frames | segs | dur(s)  | inf(s)  | RTF    | WER%   | CER%   | hyp_ch | ref_ch');
		console.log('----------------|-----|------|-----|-------|--------|------|---------|---------|--------|--------|--------|-------|-------');
		for (const r of results) {
			const l = r.label.padEnd(16);
			const f = String(r.fps).padStart(3);
			const ts = String(r.textScore ?? 0.5).padStart(4);
			const so = r.subtitleOnly ? 'Y' : 'N';
			const eng = (r.engine || 'python').padEnd(5);
			const fr = String(r.frames).padStart(6);
			const s = String(r.segments).padStart(4);
			const d = String(r.audio_duration_s).padStart(7);
			const inf = r.ocr_inference_s != null ? String(r.ocr_inference_s).padStart(7) : '      —';
			const rtf = r.ocr_rtf != null ? String(r.ocr_rtf).padStart(6) : '     —';
			const w = (r.wer * 100).toFixed(2).padStart(6);
			const c = (r.cer * 100).toFixed(2).padStart(6);
			const hc = String(r.hyp_chars).padStart(7);
			const rc = String(r.ref_chars).padStart(7);
			console.log(`${l} | ${f} | ${ts} |  ${so} | ${eng} | ${fr} | ${s} | ${d} | ${inf} | ${rtf} | ${w}% | ${c}% | ${hc} | ${rc}`);
		}
	}

	main().catch(console.error);
}
