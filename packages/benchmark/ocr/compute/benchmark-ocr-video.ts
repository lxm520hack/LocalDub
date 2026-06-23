import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { main as evalOcrMain } from '../../ref/compute/eval-ocr.ts';
import { createSessions, ocrFrameWithSessions, releaseSessions } from '../../../subtitle-ocr/subtitle-node.ts';
import { FrameResult, Segment, mergeFrames } from '../../../cli/src/feat/stages/utils/ocrMerge.ts';
import { REPO_ROOT } from '@repo/config';


/** Find rapidocr model directory dynamically.
 *  Supports multiple venv layouts (Windows/Linux standard venv and custom layouts).
 *  Use OCR_MODELS_DIR env var to override.
 */
function findRapidOCRModelsDir(): string {
	if (process.env.OCR_MODELS_DIR && existsSync(process.env.OCR_MODELS_DIR)) {
		return process.env.OCR_MODELS_DIR;
	}
	const venvBase = resolve(REPO_ROOT, '.venv');
	const modelsSub = join('rapidocr_onnxruntime', 'models');
	const candidates: string[] = [];
	if (process.platform === 'win32') {
		candidates.push(resolve(venvBase, 'Lib', 'site-packages', modelsSub));
	} else {
		const libDir = resolve(venvBase, 'lib');
		if (existsSync(libDir)) {
			const entries = readdirSync(libDir, { withFileTypes: true });
			const pyDirs = entries.filter(e =>
				e.isDirectory() && /^python\d+\.\d+$/.test(e.name)
			).map(e => e.name).sort().reverse();
			for (const pyDir of pyDirs) {
				candidates.push(resolve(libDir, pyDir, 'site-packages', modelsSub));
			}
			const sitePackagesLegacy = resolve(libDir, 'site-packages');
			if (existsSync(sitePackagesLegacy)) {
				const spEntries = readdirSync(sitePackagesLegacy, { withFileTypes: true });
				const spPyDirs = spEntries.filter(e =>
					e.isDirectory() && /^python\d+\.\d+$/.test(e.name)
				).map(e => e.name).sort().reverse();
				for (const pyDir of spPyDirs) {
					candidates.push(resolve(sitePackagesLegacy, pyDir, modelsSub));
				}
				candidates.push(resolve(sitePackagesLegacy, modelsSub));
			}
		}
	}
	for (const c of candidates) {
		if (existsSync(c)) return c;
	}
	throw new Error(
		`rapidocr models not found. Searched: ${candidates.join(', ')}\n` +
		`Hint: pip install rapidocr-onnxruntime in .venv, or set OCR_MODELS_DIR env var.`
	);
}

const VIDEOS_PATH = join(REPO_ROOT, 'packages', 'benchmark', 'ref', 'media');
const VIDEO_PATH = join(VIDEOS_PATH, 'video_source.mp4');
// 系统 PATH 可能包含极简版 ffmpeg（无 mjpeg 编码器），优先使用系统完整 ffmpeg
function findFullBin(name: string): string {
	const candidates = [`/usr/bin/${name}`, `/usr/local/bin/${name}`];
	for (const c of candidates) if (existsSync(c)) return c;
	return name;
}
const FFMPEG_BIN = process.env.BENCHMARK_FFMPEG || findFullBin('ffmpeg');
const FFPROBE_BIN = process.env.BENCHMARK_FFPROBE || findFullBin('ffprobe');
const CPP_BIN = resolve(REPO_ROOT, 'packages', 'subtitle-ocr', 'subtitle-cpp', 'build', 'ocr_pipeline');
const CPP_LD_PATH = resolve(REPO_ROOT, 'packages', 'subtitle-ocr', 'subtitle-cpp', 'build');
const CPP_OPENCV_BIN = resolve(REPO_ROOT, 'packages', 'subtitle-ocr', 'subtitle-opencv-cpp', 'build', 'ocr_pipeline_opencv');
const CPP_OPENCV_LD_PATH = resolve(REPO_ROOT, 'packages', 'subtitle-ocr', 'subtitle-opencv-cpp', 'build');
const RUST_BIN = resolve(REPO_ROOT, 'packages', 'subtitle-rust', 'target', 'release', 'ocr_pipeline_rs');
const RUST_INFER_PY = resolve(REPO_ROOT, 'packages', 'subtitle-rust', 'infer_onnx.py');
const OCR_MODELS_DIR = findRapidOCRModelsDir();
const OCR_KEYS_PATH = resolve(REPO_ROOT, 'packages', 'subtitle-ocr', 'ppocr_keys.json');
const PYTHON_BIN = join(REPO_ROOT, '.venv', 'bin', 'python');
const OCR_PY = resolve(REPO_ROOT, 'packages', 'subtitle-ocr', 'subtitle-py.py');
const GROUND_TRUTH = resolve(REPO_ROOT, 'packages', 'benchmark', 'ref', 'metadata', 'ocr_manual.json');
const RESULTS_BASE = resolve(__dirname, '..', 'results');
const TMP = resolve(REPO_ROOT, 'packages', 'tmp', 'ocr-bench');
let globalLabelSuffix: string | null = null;

interface OCRLine {
	text: string;
	confidence: number;
}

interface OCRResult {
	lines: OCRLine[];
	inferenceMs: number;
}

function runEvalOCR(ocrPath: string, label: string): { wer: number; cer: number; hyp_chars: number; ref_chars: number; } {
	const result = evalOcrMain({ gtPath: GROUND_TRUTH, hypPath: ocrPath, label, hypScaleMs: 1 });
	return {
		wer: result.normalized.cer / 100,
		cer: result.normalized.cer / 100,
		hyp_chars: result.normalized.hypChars,
		ref_chars: result.normalized.refChars,
	};
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

interface CppFrameTiming {
	text: string;
	confidence: number;
	totalMs: number;
	detMs: number;
	postMs: number;
	recMs: number;
}

function ocrFrameCpp(framePath: string, textScore?: number, subtitleOnly?: boolean, customBin?: string, customLdPath?: string, noNms?: boolean): CppFrameTiming {
	const args: string[] = [framePath];
	if (textScore != null) args.push(String(textScore));
	if (subtitleOnly) args.push('--subtitle-only');
	if (noNms) args.push('--no-nms');
	const bin = customBin || CPP_BIN;
	const ldPath = customLdPath || CPP_LD_PATH;
	const r = spawnSync(bin, args, {
		timeout: 60_000,
		encoding: 'utf-8',
		env: { ...process.env, LD_LIBRARY_PATH: ldPath, OCR_MODELS_DIR: OCR_MODELS_DIR, OCR_KEYS_PATH: OCR_KEYS_PATH },
	});
	if (r.status !== 0) {
		console.error(`  C++ OCR error: ${r.stderr?.slice(-200) || `exit ${r.status}`}`);
		return { text: '', confidence: 0, totalMs: 0, detMs: 0, postMs: 0, recMs: 0 };
	}
	const parsed = JSON.parse(r.stdout);
	const segs: { text: string; confidence: number }[] = parsed.segments || [];
	const best = segs.reduce(
		(a, b) => (a.confidence > b.confidence ? a : b),
		{ text: '', confidence: 0 }
	);
	return {
		text: best.text || '',
		confidence: best.confidence || 0,
		totalMs: parsed.totalMs ?? 0,
		detMs: parsed.detInferenceMs ?? 0,
		postMs: parsed.postprocessMs ?? 0,
		recMs: parsed.recInferenceMs ?? 0,
	};
}

function extractFrames(videoPath: string, outDir: string, fps: number = 1): { durationS: number; step: number; srcFps: number } {
	mkdirSync(outDir, { recursive: true });
	const probe = spawnSync(FFPROBE_BIN, [
		'-v', 'error', '-show_entries', 'format=duration',
		'-of', 'csv=p=0', videoPath,
	], { timeout: 15_000, encoding: 'utf-8' });
	const duration = parseFloat(probe.stdout?.trim() || '0');
	if (!duration) throw new Error('Could not probe video duration');

	const frProbe = spawnSync(FFPROBE_BIN, [
		'-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate',
		'-of', 'csv=p=0', videoPath,
	], { timeout: 10_000, encoding: 'utf-8' });
	const frParts = (frProbe.stdout?.trim() || '30/1').split('/');
	const srcFps = parseInt(frParts[0]) / parseInt(frParts[1]);
	const step = Math.round(srcFps / fps);

	const r = spawnSync(FFMPEG_BIN, [
		'-y', '-i', videoPath,
		'-vf', `select='not(mod(n,${step}))'`,
		'-vsync', 'vfr',
		'-qscale:v', '2',
		join(outDir, 'frame_%05d.jpg'),
	], { timeout: 300_000 });
	if (r.status !== 0) {
		throw new Error(`ffmpeg frame extraction failed (exit ${r.status}): ${r.stderr?.toString().slice(-300) || ''}`);
	}

	return { durationS: duration, step, srcFps };
}

function runOCRBenchmarkPython(label: string, fps: number, textScore?: number, subtitleOnly?: boolean) {
	const outDir = join(RESULTS_BASE, label);
	const metadataDir = join(outDir, 'metadata');
	mkdirSync(metadataDir, { recursive: true });
	const frameDir = framesDir(label);

	if (!existsSync(VIDEO_PATH)) throw new Error(`Video not found: ${VIDEO_PATH}`);

	console.log(`\n=== OCR Benchmark: ${label} (fps=${fps}, engine=python) ===`);

	console.log(`  extracting frames at ${fps}fps...`);
	const { durationS, step, srcFps } = extractFrames(VIDEO_PATH, frameDir, fps);

	console.log(`  OCR'ing frames (${durationS.toFixed(1)}s @ ${fps}fps ≈ ${Math.ceil(durationS * fps)} frames)...`);
	const frameFiles = spawnSync('ls', [frameDir], { encoding: 'utf-8' })
		.stdout.trim().split('\n')
		.filter(f => f.endsWith('.jpg'))
		.sort();

	const frameResults: FrameResult[] = [];
	let ocrInferenceS = 0;
	for (let i = 0; i < frameFiles.length; i++) {
		const f = frameFiles[i];
		const framePath = join(frameDir, f);
		const timestampMs = Math.round((i * step / srcFps) * 1000);
		const ocrResult = ocrFramePython(framePath, textScore, undefined, subtitleOnly);
		ocrInferenceS += ocrResult.inferenceMs / 1000;
		const best = ocrResult.lines.reduce((a, b) => a.confidence > b.confidence ? a : b, { text: '', confidence: 0 });
		frameResults.push({
			text: best.text,
			timestamp: timestampMs,
			confidence: best.confidence,
		});
		if ((i + 1) % 100 === 0) console.log(`  OCR: ${i + 1}/${frameFiles.length}`);
	}

	const segments = mergeFrames(frameResults);
	console.log(`  merged ${frameResults.length} frames → ${segments.length} segments`);

	const text = segments.map(s => s.text).join('');
	const audioDurMs = segments.length > 0 ? segments[segments.length - 1].end : Math.round(durationS * 1000);

	const ocrOutput = {
		audio_info: { duration: audioDurMs },
		result: { text, segments: segments.map(s => ({ text: s.text, start: s.start, end: s.end, confidence: s.confidence, ...(s.box_y ? { box_y: s.box_y } : {}) })) },
		_engine: 'rapidocr-onnxruntime',
		_source: 'video_hardsub',
		_fps: fps,
		_textScore: textScore ?? 0.45,
		_subtitleOnly: subtitleOnly ?? false,
		_labelSuffix: globalLabelSuffix ?? undefined,
	};
	const ocrPath = join(metadataDir, 'ocr.json');
	writeFileSync(ocrPath, JSON.stringify(ocrOutput, null, 2));

	const cerData = runEvalOCR(ocrPath, label);

	const summary = {
		label,
		fps,
		engine: 'python',
		frames: frameResults.length,
		segments: segments.length,
		audio_duration_s: parseFloat((audioDurMs / 1000).toFixed(1)),
		ocr_inference_s: parseFloat(ocrInferenceS.toFixed(3)),
		ocr_rtf: parseFloat((ocrInferenceS / (audioDurMs / 1000)).toFixed(4)),
		wer: cerData.wer ?? 0,
		cer: cerData.cer ?? 0,
		hyp_chars: cerData.hyp_chars ?? text.length,
		ref_chars: cerData.ref_chars ?? 0,
		textScore: textScore ?? 0.45,
		subtitleOnly: subtitleOnly ?? false,
	};
	writeFileSync(join(metadataDir, 'summary.json'), JSON.stringify(summary, null, 2));

	console.log(`  segs=${segments.length} dur=${(audioDurMs / 1000).toFixed(1)}s`);
	console.log(`  OCR inf=${ocrInferenceS.toFixed(1)}s RTF=${(ocrInferenceS / (audioDurMs / 1000)).toFixed(4)}`);
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
	const { durationS: durationSNode, step: stepNode, srcFps: srcFpsNode } = extractFrames(VIDEO_PATH, frameDir, fps);

	console.log(`  OCR'ing frames (${durationSNode.toFixed(1)}s @ ${fps}fps ≈ ${Math.ceil(durationSNode * fps)} frames)...`);
	const frameFiles = spawnSync('ls', [frameDir], { encoding: 'utf-8' })
		.stdout.trim().split('\n')
		.filter(f => f.endsWith('.jpg'))
		.sort();

	// Create sessions once
	console.log('  creating ORT sessions...');
	const sessions = await createSessions('cpu');

	const frameResultsNode: FrameResult[] = [];
	let ocrInferenceS = 0;
	for (let i = 0; i < frameFiles.length; i++) {
		const f = frameFiles[i];
		const framePath = join(frameDir, f);
		const timestampMs = Math.round((i * stepNode / srcFpsNode) * 1000);
		const result = await ocrFrameWithSessions(framePath, sessions, { textScore, subtitleOnly });
		ocrInferenceS += result.totalMs / 1000;
		const best = result.segments.length > 0
			? result.segments.reduce((a, b) => a.confidence > b.confidence ? a : b)
			: { text: '', confidence: 0 };
		frameResultsNode.push({
			text: result.text || '',
			timestamp: timestampMs,
			confidence: best.confidence,
		});
		if ((i + 1) % 50 === 0) console.log(`  OCR: ${i + 1}/${frameFiles.length}`);
	}

	await releaseSessions(sessions);

	const segmentsNode = mergeFrames(frameResultsNode);
	console.log(`  merged ${frameResultsNode.length} frames → ${segmentsNode.length} segments`);

	const textNode = segmentsNode.map(s => s.text).join('');
	const audioDurMs = segmentsNode.length > 0 ? segmentsNode[segmentsNode.length - 1].end : Math.round(durationSNode * 1000);

	const ocrOutput = {
		audio_info: { duration: audioDurMs },
		result: { text: textNode, segments: segmentsNode.map(s => ({ text: s.text, start: s.start, end: s.end, confidence: s.confidence, ...(s.box_y ? { box_y: s.box_y } : {}) })) },
		_engine: 'ocr-node',
		_source: 'video_hardsub',
		_fps: fps,
		_textScore: textScore ?? 0.45,
		_subtitleOnly: subtitleOnly ?? false,
		_labelSuffix: globalLabelSuffix ?? undefined,
	};
	const ocrPath = join(metadataDir, 'ocr.json');
	writeFileSync(ocrPath, JSON.stringify(ocrOutput, null, 2));

	const cerData = runEvalOCR(ocrPath, label);

	const summary = {
		label,
		fps,
		engine: 'node',
		frames: frameResultsNode.length,
		segments: segmentsNode.length,
		audio_duration_s: parseFloat((audioDurMs / 1000).toFixed(1)),
		ocr_inference_s: parseFloat(ocrInferenceS.toFixed(3)),
		ocr_rtf: parseFloat((ocrInferenceS / (audioDurMs / 1000)).toFixed(4)),
		wer: cerData.wer ?? 0,
		cer: cerData.cer ?? 0,
		hyp_chars: cerData.hyp_chars ?? textNode.length,
		ref_chars: cerData.ref_chars ?? 0,
		textScore: textScore ?? 0.45,
		subtitleOnly: subtitleOnly ?? false,
	};
	writeFileSync(join(metadataDir, 'summary.json'), JSON.stringify(summary, null, 2));

	console.log(`  segs=${segmentsNode.length} dur=${(audioDurMs / 1000).toFixed(1)}s`);
	console.log(`  OCR inf=${ocrInferenceS.toFixed(1)}s RTF=${(ocrInferenceS / (audioDurMs / 1000)).toFixed(4)}`);
	console.log(`  WER=${(cerData.wer * 100).toFixed(2)}% CER=${(cerData.cer * 100).toFixed(2)}%`);
	console.log(`  hyp_chars=${cerData.hyp_chars} ref_chars=${cerData.ref_chars}`);

	spawnSync('rm', ['-rf', frameDir]);

	return summary;
}

function runOCRBenchmarkCpp(label: string, fps: number, textScore?: number, subtitleOnly?: boolean) {
	const outDir = join(RESULTS_BASE, label);
	const metadataDir = join(outDir, 'metadata');
	mkdirSync(metadataDir, { recursive: true });
	const frameDir = framesDir(label);

	if (!existsSync(VIDEO_PATH)) throw new Error(`Video not found: ${VIDEO_PATH}`);

	console.log(`\n=== OCR Benchmark: ${label} (fps=${fps}, engine=cpp) ===`);

	console.log('  extracting frames...');
	const { durationS: durationSCpp, step: stepCpp, srcFps: srcFpsCpp } = extractFrames(VIDEO_PATH, frameDir, fps);

	console.log(`  OCR'ing ${Math.ceil(durationSCpp * fps)} frames...`);
	const frameFiles = spawnSync('ls', [frameDir], { encoding: 'utf-8' })
		.stdout.trim().split('\n')
		.filter(f => f.endsWith('.jpg'))
		.sort();

	const frameResultsCpp: FrameResult[] = [];
	let totalMs = 0, totalDetMs = 0, totalPostMs = 0, totalRecMs = 0;
	for (let i = 0; i < frameFiles.length; i++) {
		const f = frameFiles[i];
		const framePath = join(frameDir, f);
		const timestampMs = Math.round((i * stepCpp / srcFpsCpp) * 1000);
		const result = ocrFrameCpp(framePath, textScore, subtitleOnly);
		totalMs += result.totalMs;
		totalDetMs += result.detMs;
		totalPostMs += result.postMs;
		totalRecMs += result.recMs;
		frameResultsCpp.push({
			text: result.text || '',
			timestamp: timestampMs,
			confidence: result.confidence || 0,
		});
		if ((i + 1) % 50 === 0) console.log(`  OCR: ${i + 1}/${frameFiles.length}`);
	}

	const segmentsCpp = mergeFrames(frameResultsCpp);
	console.log(`  merged ${frameFiles.length} frames → ${segmentsCpp.length} segments`);

	const textCpp = segmentsCpp.map(s => s.text).join('');
	const audioDurMs = segmentsCpp.length > 0 ? segmentsCpp[segmentsCpp.length - 1].end : Math.round(durationSCpp * 1000);
	const inferenceS = totalMs / 1000;

	const ocrOutput = {
		audio_info: { duration: audioDurMs },
		result: { text: textCpp, segments: segmentsCpp.map(s => ({ text: s.text, start: s.start, end: s.end, confidence: s.confidence, ...(s.box_y ? { box_y: s.box_y } : {}) })) },
		_engine: 'subtitle-cpp',
		_source: 'video_hardsub',
		_fps: fps,
		_textScore: textScore ?? 0.45,
		_subtitleOnly: subtitleOnly ?? false,
		_timingsMs: {
			total: Math.round(totalMs),
			averagePerFrame: Math.round(totalMs / frameResultsCpp.length),
			det: Math.round(totalDetMs),
			post: Math.round(totalPostMs),
			rec: Math.round(totalRecMs),
		},
	};
	const ocrPath = join(metadataDir, 'ocr.json');
	writeFileSync(ocrPath, JSON.stringify(ocrOutput, null, 2));

	const cerData = runEvalOCR(ocrPath, label);

	const summary = {
		label,
		fps,
		engine: 'cpp',
		frames: frameResultsCpp.length,
		segments: segmentsCpp.length,
		audio_duration_s: parseFloat((audioDurMs / 1000).toFixed(1)),
		ocr_inference_s: parseFloat(inferenceS.toFixed(3)),
		ocr_rtf: parseFloat((inferenceS / (audioDurMs / 1000)).toFixed(4)),
		ocr_timings_ms: {
			total: Math.round(totalMs),
			avgPerFrame: Math.round(totalMs / frameResultsCpp.length),
			det: Math.round(totalDetMs),
			post: Math.round(totalPostMs),
			rec: Math.round(totalRecMs),
		},
		wer: cerData.wer ?? 0,
		cer: cerData.cer ?? 0,
		hyp_chars: cerData.hyp_chars ?? textCpp.length,
		ref_chars: cerData.ref_chars ?? 0,
		textScore: textScore ?? 0.45,
		subtitleOnly: subtitleOnly ?? false,
	};
	writeFileSync(join(metadataDir, 'summary.json'), JSON.stringify(summary, null, 2));

	console.log(`  segs=${segmentsCpp.length} dur=${(audioDurMs / 1000).toFixed(1)}s`);
	console.log(`  det=${Math.round(totalDetMs)}ms post=${Math.round(totalPostMs)}ms rec=${Math.round(totalRecMs)}ms total=${Math.round(totalMs)}ms`);
	console.log(`  avg/frame=${Math.round(totalMs / frameResultsCpp.length)}ms  inference=${inferenceS.toFixed(3)}s RTF=${(inferenceS / (audioDurMs / 1000)).toFixed(4)}`);
	console.log(`  WER=${(cerData.wer * 100).toFixed(2)}% CER=${(cerData.cer * 100).toFixed(2)}%`);
	console.log(`  hyp_chars=${cerData.hyp_chars} ref_chars=${cerData.ref_chars}`);

	spawnSync('rm', ['-rf', frameDir]);

	return summary;
}

function runOCRBenchmarkCppOpencv(label: string, fps: number, textScore?: number, subtitleOnly?: boolean, noNms?: boolean) {
	const outDir = join(RESULTS_BASE, label);
	const metadataDir = join(outDir, 'metadata');
	mkdirSync(metadataDir, { recursive: true });
	const frameDir = framesDir(label);

	if (!existsSync(VIDEO_PATH)) throw new Error(`Video not found: ${VIDEO_PATH}`);

	console.log(`\n=== OCR Benchmark: ${label} (fps=${fps}, engine=cpp-opencv, noNms=${noNms ?? false}) ===`);

	console.log('  extracting frames...');
	const { durationS: durationSCpp, step: stepCpp, srcFps: srcFpsCpp } = extractFrames(VIDEO_PATH, frameDir, fps);

	console.log(`  OCR'ing ${Math.ceil(durationSCpp * fps)} frames (batch --dir mode)...`);
	const frameFiles = spawnSync('ls', [frameDir], { encoding: 'utf-8' })
		.stdout.trim().split('\n')
		.filter(f => f.endsWith('.jpg'))
		.sort();

	const args: string[] = ['--dir', frameDir];
	if (textScore != null) args.push(String(textScore));
	if (subtitleOnly) args.push('--subtitle-only');
	if (noNms) args.push('--no-nms');
	const r = spawnSync(CPP_OPENCV_BIN, args, {
		timeout: 600_000,
		encoding: 'utf-8',
		env: { ...process.env, LD_LIBRARY_PATH: CPP_OPENCV_LD_PATH, OCR_MODELS_DIR, OCR_KEYS_PATH },
	});
	if (r.status !== 0) {
		throw new Error(`cpp-opencv OCR error: ${r.stderr?.slice(-300) || `exit ${r.status}`}`);
	}
	const batchResults: any[] = JSON.parse(r.stdout);

	const frameResultsCpp: FrameResult[] = [];
	let totalMs = 0, totalDetMs = 0, totalPostMs = 0, totalRecMs = 0;
	for (let i = 0; i < frameFiles.length; i++) {
		const timestampMs = Math.round((i * stepCpp / srcFpsCpp) * 1000);
		const data = batchResults[i] || { segments: [], text: '' };
		const segs: { text: string; confidence: number }[] = data.segments || [];
		const best = segs.length > 0
			? segs.reduce((a: any, b: any) => a.confidence > b.confidence ? a : b)
			: { text: '', confidence: 0 };
		totalMs += (data.detInferenceMs || 0) + (data.postprocessMs || 0) + (data.recInferenceMs || 0);
		totalDetMs += data.detInferenceMs || 0;
		totalPostMs += data.postprocessMs || 0;
		totalRecMs += data.recInferenceMs || 0;
		frameResultsCpp.push({
			text: data.text || '',
			timestamp: timestampMs,
			confidence: best.confidence || 0,
		});
	}

	const segmentsCpp = mergeFrames(frameResultsCpp);
	console.log(`  merged ${frameFiles.length} frames → ${segmentsCpp.length} segments`);

	const textCpp = segmentsCpp.map(s => s.text).join('');
	const audioDurMs = segmentsCpp.length > 0 ? segmentsCpp[segmentsCpp.length - 1].end : Math.round(durationSCpp * 1000);
	const inferenceS = totalMs / 1000;

	const ocrOutput = {
		audio_info: { duration: audioDurMs },
		result: { text: textCpp, segments: segmentsCpp.map(s => ({ text: s.text, start: s.start, end: s.end, confidence: s.confidence, ...(s.box_y ? { box_y: s.box_y } : {}) })) },
		_engine: 'subtitle-opencv-cpp',
		_source: 'video_hardsub',
		_fps: fps,
		_textScore: textScore ?? 0.45,
		_subtitleOnly: subtitleOnly ?? false,
		_timingsMs: {
			total: Math.round(totalMs),
			averagePerFrame: Math.round(totalMs / frameResultsCpp.length),
			det: Math.round(totalDetMs),
			post: Math.round(totalPostMs),
			rec: Math.round(totalRecMs),
		},
	};
	const ocrPath = join(metadataDir, 'ocr.json');
	writeFileSync(ocrPath, JSON.stringify(ocrOutput, null, 2));

	const cerData = runEvalOCR(ocrPath, label);

	const summary = {
		label,
		fps,
		engine: 'cpp-opencv',
		frames: frameResultsCpp.length,
		segments: segmentsCpp.length,
		audio_duration_s: parseFloat((audioDurMs / 1000).toFixed(1)),
		ocr_inference_s: parseFloat(inferenceS.toFixed(3)),
		ocr_rtf: parseFloat((inferenceS / (audioDurMs / 1000)).toFixed(4)),
		ocr_timings_ms: {
			total: Math.round(totalMs),
			avgPerFrame: Math.round(totalMs / frameResultsCpp.length),
			det: Math.round(totalDetMs),
			post: Math.round(totalPostMs),
			rec: Math.round(totalRecMs),
		},
		wer: cerData.wer ?? 0,
		cer: cerData.cer ?? 0,
		hyp_chars: cerData.hyp_chars ?? textCpp.length,
		ref_chars: cerData.ref_chars ?? 0,
		textScore: textScore ?? 0.45,
		subtitleOnly: subtitleOnly ?? false,
	};
	writeFileSync(join(metadataDir, 'summary.json'), JSON.stringify(summary, null, 2));

	console.log(`  segs=${segmentsCpp.length} dur=${(audioDurMs / 1000).toFixed(1)}s`);
	console.log(`  det=${Math.round(totalDetMs)}ms post=${Math.round(totalPostMs)}ms rec=${Math.round(totalRecMs)}ms total=${Math.round(totalMs)}ms`);
	console.log(`  avg/frame=${Math.round(totalMs / frameResultsCpp.length)}ms  inference=${inferenceS.toFixed(3)}s RTF=${(inferenceS / (audioDurMs / 1000)).toFixed(4)}`);
	console.log(`  WER=${(cerData.wer * 100).toFixed(2)}% CER=${(cerData.cer * 100).toFixed(2)}%`);
	console.log(`  hyp_chars=${cerData.hyp_chars} ref_chars=${cerData.ref_chars}`);

	spawnSync('rm', ['-rf', frameDir]);

	return summary;
}

function runOCRBenchmarkRust(label: string, fps: number, textScore?: number, subtitleOnly?: boolean) {
	const outDir = join(RESULTS_BASE, label);
	const metadataDir = join(outDir, 'metadata');
	mkdirSync(metadataDir, { recursive: true });
	const frameDir = framesDir(label);

	if (!existsSync(VIDEO_PATH)) throw new Error(`Video not found: ${VIDEO_PATH}`);
	if (!existsSync(RUST_BIN)) throw new Error(`Rust binary not found: ${RUST_BIN}. Run 'cd packages/subtitle-rust && cargo build --release'.`);

	console.log(`\n=== OCR Benchmark: ${label} (fps=${fps}, engine=rust) ===`);

	console.log('  extracting frames...');
	const { durationS: durationSRust, step: stepRust, srcFps: srcFpsRust } = extractFrames(VIDEO_PATH, frameDir, fps);

	console.log(`  OCR'ing ${Math.ceil(durationSRust * fps)} frames (batch --dir mode)...`);
	const frameFiles = spawnSync('ls', [frameDir], { encoding: 'utf-8' })
		.stdout.trim().split('\n')
		.filter(f => f.endsWith('.jpg'))
		.sort();

	const argsRust = ['--dir', frameDir];
	if (textScore != null) argsRust.push(String(textScore));
	if (subtitleOnly) argsRust.push('--subtitle-only');
	const rRust = spawnSync(RUST_BIN, argsRust, {
		timeout: 600_000,
		encoding: 'utf-8',
		env: { ...process.env, OCR_MODELS_DIR, OCR_KEYS_PATH, OCR_INFER_PY: RUST_INFER_PY },
	});
	if (rRust.status !== 0) {
		throw new Error(`Rust OCR error: ${rRust.stderr?.slice(-300) || `exit ${rRust.status}`}`);
	}
	const batchResultsRust: any[] = JSON.parse(rRust.stdout);

	const frameResultsRust: FrameResult[] = [];
	let totalMs = 0, totalDetMs = 0, totalPostMs = 0, totalRecMs = 0;
	for (let i = 0; i < frameFiles.length; i++) {
		const timestampMs = Math.round((i * stepRust / srcFpsRust) * 1000);
		const data = batchResultsRust[i] || { segments: [], text: '' };
		const segs: { text: string; confidence: number }[] = data.segments || [];
		const best = segs.length > 0
			? segs.reduce((a: any, b: any) => a.confidence > b.confidence ? a : b)
			: { text: '', confidence: 0 };
		const totalF = (data.det_inference_ms || 0) + (data.postprocess_ms || 0) + (data.rec_inference_ms || 0);
		totalMs += totalF;
		totalDetMs += data.det_inference_ms || 0;
		totalPostMs += data.postprocess_ms || 0;
		totalRecMs += data.rec_inference_ms || 0;
		frameResultsRust.push({
			text: data.text || '',
			timestamp: timestampMs,
			confidence: best.confidence || 0,
		});
	}

	const segmentsRust = mergeFrames(frameResultsRust);
	console.log(`  merged ${frameFiles.length} frames → ${segmentsRust.length} segments`);

	const textRust = segmentsRust.map(s => s.text).join('');
	const audioDurMs = segmentsRust.length > 0 ? segmentsRust[segmentsRust.length - 1].end : Math.round(durationSRust * 1000);
	const inferenceS = totalMs / 1000;

	const ocrOutput = {
		audio_info: { duration: audioDurMs },
		result: { text: textRust, segments: segmentsRust.map(s => ({ text: s.text, start: s.start, end: s.end, confidence: s.confidence, ...(s.box_y ? { box_y: s.box_y } : {}) })) },
		_engine: 'subtitle-rust',
		_source: 'video_hardsub',
		_fps: fps,
		_textScore: textScore ?? 0.45,
		_subtitleOnly: subtitleOnly ?? false,
		_timingsMs: {
			total: Math.round(totalMs),
			averagePerFrame: Math.round(totalMs / frameResultsRust.length),
			det: Math.round(totalDetMs),
			post: Math.round(totalPostMs),
			rec: Math.round(totalRecMs),
		},
	};
	const ocrPath = join(metadataDir, 'ocr.json');
	writeFileSync(ocrPath, JSON.stringify(ocrOutput, null, 2));

	const cerData = runEvalOCR(ocrPath, label);

	const summary = {
		label,
		fps,
		engine: 'rust',
		frames: frameResultsRust.length,
		segments: segmentsRust.length,
		audio_duration_s: parseFloat((audioDurMs / 1000).toFixed(1)),
		ocr_inference_s: parseFloat(inferenceS.toFixed(3)),
		ocr_rtf: parseFloat((inferenceS / (audioDurMs / 1000)).toFixed(4)),
		ocr_timings_ms: {
			total: Math.round(totalMs),
			avgPerFrame: Math.round(totalMs / frameResultsRust.length),
			det: Math.round(totalDetMs),
			post: Math.round(totalPostMs),
			rec: Math.round(totalRecMs),
		},
		wer: cerData.wer ?? 0,
		cer: cerData.cer ?? 0,
		hyp_chars: cerData.hyp_chars ?? textRust.length,
		ref_chars: cerData.ref_chars ?? 0,
		textScore: textScore ?? 0.45,
		subtitleOnly: subtitleOnly ?? false,
	};
	writeFileSync(join(metadataDir, 'summary.json'), JSON.stringify(summary, null, 2));

	console.log(`  segs=${segmentsRust.length} dur=${(audioDurMs / 1000).toFixed(1)}s`);
	console.log(`  det=${Math.round(totalDetMs)}ms post=${Math.round(totalPostMs)}ms rec=${Math.round(totalRecMs)}ms total=${Math.round(totalMs)}ms`);
	console.log(`  avg/frame=${Math.round(totalMs / frameResultsRust.length)}ms  inference=${inferenceS.toFixed(3)}s RTF=${(inferenceS / (audioDurMs / 1000)).toFixed(4)}`);
	console.log(`  WER=${(cerData.wer * 100).toFixed(2)}% CER=${(cerData.cer * 100).toFixed(2)}%`);
	console.log(`  hyp_chars=${cerData.hyp_chars} ref_chars=${cerData.ref_chars}`);

	spawnSync('rm', ['-rf', frameDir]);

	return summary;
}

// ---
if (require.main === module) {
	const engine = process.argv.includes('--engine') ? process.argv[process.argv.indexOf('--engine') + 1] : 'python';
	const onlyLabel = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
	const runs = process.argv.includes('--runs') ? parseInt(process.argv[process.argv.indexOf('--runs') + 1], 10) : 1;
	globalLabelSuffix = process.argv.includes('--label-suffix') ? process.argv[process.argv.indexOf('--label-suffix') + 1] : null;
	const labelOverride = process.argv.includes('--label-override') ? process.argv[process.argv.indexOf('--label-override') + 1] : null;
	const noNms = process.argv.includes('--no-nms');
	console.log(`Engine: ${engine}  Only: ${onlyLabel ?? 'all'}  Runs: ${runs}${globalLabelSuffix ? `  LabelSuffix: ${globalLabelSuffix}` : ''}${labelOverride ? `  LabelOverride: ${labelOverride}` : ''}${noNms ? `  NMS=OFF` : ''}`);

	async function main() {
		const fpsOptions: { fps: number; textScore?: number; subtitleOnly?: boolean }[] = [
			{ fps: 2, textScore: 0.45, subtitleOnly: true },
			{ fps: 1, textScore: 0.3, subtitleOnly: true },
			{ fps: 1, textScore: 0.4, subtitleOnly: true },
			{ fps: 1, textScore: 0.45, subtitleOnly: true },
			{ fps: 1, textScore: 0.5, subtitleOnly: true },
			{ fps: 1, textScore: 0.45 },
			{ fps: 0.5, textScore: 0.45, subtitleOnly: true },
		];
		const results: any[] = [];

		for (const opt of fpsOptions) {
			const tsLabel = opt.textScore != null ? `-ts${opt.textScore}` : '';
			const baseLabel = `ocr-${engine}-fps${opt.fps}${opt.subtitleOnly ? '-so' : ''}${tsLabel}`;
			if (onlyLabel && baseLabel !== onlyLabel) continue;

			if (labelOverride) {
				const label = labelOverride;
				let r: any;
				if (engine === 'node') {
					r = await runOCRBenchmarkNode(label, opt.fps, opt.textScore, opt.subtitleOnly);
				} else if (engine === 'cpp-opencv') {
					r = runOCRBenchmarkCppOpencv(label, opt.fps, opt.textScore, opt.subtitleOnly, noNms);
				} else if (engine === 'cpp') {
					r = runOCRBenchmarkCpp(label, opt.fps, opt.textScore, opt.subtitleOnly);
				} else if (engine === 'rust') {
					r = runOCRBenchmarkRust(label, opt.fps, opt.textScore, opt.subtitleOnly);
				} else {
					r = runOCRBenchmarkPython(label, opt.fps, opt.textScore, opt.subtitleOnly);
				}
				results.push(r);
				break;
			} else if (globalLabelSuffix) {
				const label = `${baseLabel}-${globalLabelSuffix}`;
				let r: any;
				if (engine === 'node') {
					r = await runOCRBenchmarkNode(label, opt.fps, opt.textScore, opt.subtitleOnly);
				} else if (engine === 'cpp-opencv') {
					r = runOCRBenchmarkCppOpencv(label, opt.fps, opt.textScore, opt.subtitleOnly, noNms);
				} else if (engine === 'cpp') {
					r = runOCRBenchmarkCpp(label, opt.fps, opt.textScore, opt.subtitleOnly);
				} else if (engine === 'rust') {
					r = runOCRBenchmarkRust(label, opt.fps, opt.textScore, opt.subtitleOnly);
				} else {
					r = runOCRBenchmarkPython(label, opt.fps, opt.textScore, opt.subtitleOnly);
				}
				results.push(r);
			} else {
				for (let run = 0; run < runs; run++) {
					const label = runs > 1 ? `${baseLabel}-r${run}` : baseLabel;
					let r: any;
					if (engine === 'node') {
						r = await runOCRBenchmarkNode(label, opt.fps, opt.textScore, opt.subtitleOnly);
					} else if (engine === 'cpp-opencv') {
						r = runOCRBenchmarkCppOpencv(label, opt.fps, opt.textScore, opt.subtitleOnly, noNms);
					} else if (engine === 'cpp') {
						r = runOCRBenchmarkCpp(label, opt.fps, opt.textScore, opt.subtitleOnly);
					} else if (engine === 'rust') {
						r = runOCRBenchmarkRust(label, opt.fps, opt.textScore, opt.subtitleOnly);
					} else {
						r = runOCRBenchmarkPython(label, opt.fps, opt.textScore, opt.subtitleOnly);
					}
					results.push(r);
				}
			}
		}

		console.log('\n======= OCR BENCHMARK SUMMARY =======');
		console.log('label           | fps | ts   | sz  | eng         | frames | segs | dur(s)  | inf(s)  | RTF    | WER%   | CER%   | hyp_ch | ref_ch');
		console.log('----------------|-----|------|-----|-------------|--------|------|---------|---------|--------|--------|--------|-------|-------');
		for (const r of results) {
			const l = r.label.padEnd(16);
			const f = String(r.fps).padStart(3);
			const ts = String(r.textScore ?? 0.5).padStart(4);
			const so = r.subtitleOnly ? 'Y' : 'N';
			const eng = (r.engine || 'python').padEnd(11);
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
