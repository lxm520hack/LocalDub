import * as ort from '/home/aa/repos/env_ls/LocalDub/packages/cli/node_modules/onnxruntime-node';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import sharp from '/home/aa/repos/env_ls/LocalDub/node_modules/.bun/node_modules/sharp';

const REPO_ROOT = resolve(__dirname, '..', '..');
const MODEL_DIR = resolve(REPO_ROOT, '.venv', 'lib', 'python3.14', 'site-packages', 'rapidocr_onnxruntime', 'models');
const PYTHON_BIN = join(REPO_ROOT, '.venv', 'bin', 'python');
const POSTPROCESS_PY = resolve(__dirname, 'postprocess_det.py');
const KEYS_PATH = resolve(__dirname, 'ppocr_keys.json');
const TMP_DIR = join(REPO_ROOT, 'packages', 'tmp');

const DET_PATH = join(MODEL_DIR, 'ch_PP-OCRv3_det_infer.onnx');
const CLS_PATH = join(MODEL_DIR, 'ch_ppocr_mobile_v2.0_cls_infer.onnx');
const REC_PATH = join(MODEL_DIR, 'ch_PP-OCRv3_rec_infer.onnx');

const CHAR_LIST: string[] = JSON.parse(readFileSync(KEYS_PATH, 'utf-8'));

interface OCRBox { box: number[][]; score: number }

function ctcDecode(logits: Float32Array, shape: number[]): { text: string; confidence: number } {
	const [batch, timesteps, numClasses] = shape;
	const totalConf: number[] = [];
	const rawIndices: number[] = [];
	for (let t = 0; t < timesteps; t++) {
		let maxVal = -Infinity;
		let maxIdx = 0;
		for (let c = 0; c < numClasses; c++) {
			const val = logits[t * numClasses + c];
			if (val > maxVal) { maxVal = val; maxIdx = c; }
		}
		rawIndices.push(maxIdx);
		totalConf.push(maxVal);
	}

	const chars: string[] = [];
	const confs: number[] = [];
	let prev = -1;
	for (let i = 0; i < rawIndices.length; i++) {
		const idx = rawIndices[i];
		if (idx === 0) { prev = -1; continue; }
		if (idx !== prev) {
			const ch = CHAR_LIST[idx] ?? '';
			if (ch) { chars.push(ch); confs.push(totalConf[i]); }
		}
		prev = idx;
	}

	const avgConf = confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
	return { text: chars.join(''), confidence: avgConf };
}

async function preprocessDet(
	imgBuf: Buffer,
	limitSideLen = 736,
): Promise<{ tensor: Float32Array; origH: number; origW: number; resizedH: number; resizedW: number }> {
	const meta = await sharp(imgBuf).metadata();
	const origH = meta.height!;
	const origW = meta.width!;

	let newW: number, newH: number;
	if (origH <= origW) {
		newH = limitSideLen;
		newW = Math.round(origW * limitSideLen / origH);
	} else {
		newW = limitSideLen;
		newH = Math.round(origH * limitSideLen / origW);
	}
	newW = Math.ceil(newW / 32) * 32;
	newH = Math.ceil(newH / 32) * 32;

	const resized = await sharp(imgBuf)
		.resize(newW, newH, { fit: 'fill' })
		.raw()
		.toBuffer();

	const mean = [0.485, 0.456, 0.406];
	const std = [0.229, 0.224, 0.225];
	const data = new Float32Array(3 * newH * newW);
	for (let y = 0; y < newH; y++) {
		for (let x = 0; x < newW; x++) {
			for (let c = 0; c < 3; c++) {
				const pixel = resized[(y * newW + x) * 3 + c];
				data[c * newH * newW + y * newW + x] = (pixel / 255 - mean[c]) / std[c];
			}
		}
	}

	return { tensor: data, origH, origW, resizedH: newH, resizedW: newW };
}

async function preprocessCls(imgBuf: Buffer): Promise<Float32Array> {
	const resized = await sharp(imgBuf)
		.resize(192, 48, { fit: 'fill' })
		.raw()
		.toBuffer();
	const data = new Float32Array(3 * 48 * 192);
	for (let y = 0; y < 48; y++) {
		for (let x = 0; x < 192; x++) {
			for (let c = 0; c < 3; c++) {
				const pixel = resized[(y * 192 + x) * 3 + c];
				data[c * 48 * 192 + y * 192 + x] = (pixel / 255 - 0.5) / 0.5;
			}
		}
	}
	return data;
}

async function preprocessRec(imgBuf: Buffer): Promise<{ tensor: Float32Array; width: number }> {
	const H = 48;
	const meta = await sharp(imgBuf).metadata();
	const origH = meta.height!;
	const origW = meta.width!;
	const whRatio = origW / origH;
	const imgW = Math.min(320, Math.max(32, Math.round(H * whRatio)));

	const resized = await sharp(imgBuf)
		.resize(imgW, H, { fit: 'fill' })
		.raw()
		.toBuffer();

	const data = new Float32Array(3 * H * imgW);
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < imgW; x++) {
			for (let c = 0; c < 3; c++) {
				const pixel = resized[(y * imgW + x) * 3 + c];
				data[c * H * imgW + y * imgW + x] = (pixel / 255 - 0.5) / 0.5;
			}
		}
	}
	return { tensor: data, width: imgW };
}

export interface OCRSessions {
	det: ort.InferenceSession;
	cls: ort.InferenceSession;
	rec: ort.InferenceSession;
}

export async function createSessions(detEp = 'cpu'): Promise<OCRSessions> {
	const [det, cls, rec] = await Promise.all([
		ort.InferenceSession.create(DET_PATH, { executionProviders: [detEp] }),
		ort.InferenceSession.create(CLS_PATH, { executionProviders: ['cpu'] }),
		ort.InferenceSession.create(REC_PATH, { executionProviders: ['cpu'] }),
	]);
	return { det, cls, rec };
}

export async function releaseSessions(s: OCRSessions): Promise<void> {
	await Promise.all([s.det.release(), s.cls.release(), s.rec.release()]);
}

export interface OCRNodeResult {
	text: string;
	segments: { text: string; confidence: number; box: number[][] }[];
	detInferenceMs: number;
	postprocessMs: number;
	recInferenceMs: number;
	totalMs: number;
}

export async function ocrFrameWithSessions(
	imagePath: string,
	sessions: OCRSessions,
	opts?: { textScore?: number; subtitleOnly?: boolean },
): Promise<OCRNodeResult> {
	const tStart = performance.now();
	let textScore = opts?.textScore ?? 0.5;
	const subtitleOnly = opts?.subtitleOnly ?? false;

	const imgBuf = readFileSync(imagePath);

	const { tensor: detInput, origH, origW, resizedH, resizedW } = await preprocessDet(imgBuf);

	let t0 = performance.now();
	const detFeed: Record<string, ort.Tensor> = {};
	detFeed[sessions.det.inputNames[0]] = new ort.Tensor('float32', detInput, [1, 3, resizedH, resizedW]);
	const detOut = await sessions.det.run(detFeed);
	const detMs = performance.now() - t0;
	const heatmap = detOut[sessions.det.outputNames[0]] as ort.Tensor;

	// --- POST-PROCESS (Python) ---
	const tmpDir = mkdtempSync(join(TMP_DIR, 'ocr-det-'));
	const heatmapPath = join(tmpDir, 'heatmap.raw');
	const heatmapData = heatmap.data as Float32Array;
	writeFileSync(heatmapPath, Buffer.from(heatmapData.buffer, heatmapData.byteOffset, heatmapData.byteLength));

	t0 = performance.now();
	const pp = spawnSync(PYTHON_BIN, [
		POSTPROCESS_PY,
		heatmapPath,
		String(resizedH),
		String(resizedW),
		String(origH),
		String(origW),
		String(0.3),
		String(textScore),
	], { timeout: 30_000, encoding: 'utf-8' });
	const ppMs = performance.now() - t0;

	try { unlinkSync(heatmapPath); } catch {}
	try { unlinkSync(join(tmpDir, '')); } catch {}

	if (pp.status !== 0 || !pp.stdout) {
		throw new Error(`Post-process failed: ${pp.stderr?.slice(-200) || 'no output'}`);
	}
	const ppResult = JSON.parse(pp.stdout);
	if (ppResult.error) throw new Error(ppResult.error);
	const boxes: OCRBox[] = ppResult.boxes ?? [];

	// --- RECOGNITION for each box ---
	const segments: { text: string; confidence: number; box: number[][] }[] = [];
	let recMs = 0;

	for (const b of boxes) {
		const pts = b.box;
		if (!pts || pts.length < 4) continue;

		const xs = pts.map((p: number[]) => p[0]);
		const ys = pts.map((p: number[]) => p[1]);
		const xMin = Math.max(0, Math.floor(Math.min(...xs)));
		const xMax = Math.min(origW, Math.ceil(Math.max(...xs)));
		const yMin = Math.max(0, Math.floor(Math.min(...ys)));
		const yMax = Math.min(origH, Math.ceil(Math.max(...ys)));

		if (xMax - xMin < 4 || yMax - yMin < 4) continue;

		const crop = await sharp(imgBuf)
			.extract({ left: xMin, top: yMin, width: xMax - xMin, height: yMax - yMin })
			.toBuffer();

		const clsInput = await preprocessCls(crop);
		const clsFeed: Record<string, ort.Tensor> = {};
		clsFeed[sessions.cls.inputNames[0]] = new ort.Tensor('float32', clsInput, [1, 3, 48, 192]);
		const clsOut = await sessions.cls.run(clsFeed);
		const clsData = (clsOut[sessions.cls.outputNames[0]] as ort.Tensor).data as Float32Array;
		const rotate = clsData[0] < clsData[1];

		let recCrop = crop;
		if (rotate) recCrop = await sharp(crop).rotate(180).toBuffer();

		const { tensor: recInput, width: recW } = await preprocessRec(recCrop);
		t0 = performance.now();
		const recFeed: Record<string, ort.Tensor> = {};
		recFeed[sessions.rec.inputNames[0]] = new ort.Tensor('float32', recInput, [1, 3, 48, recW]);
		const recOut = await sessions.rec.run(recFeed);
		recMs += performance.now() - t0;
		const recTensor = recOut[sessions.rec.outputNames[0]] as ort.Tensor;
		const { text, confidence } = ctcDecode(recTensor.data as Float32Array, recTensor.dims as number[]);

		if (!text) continue;

		// Y-position filter for subtitle-only mode
		if (subtitleOnly) {
			const yCenter = (Math.min(...ys) + Math.max(...ys)) / 2;
			if (yCenter < 620 || yCenter > 700) continue;
		}

		segments.push({ text, confidence, box: pts });
	}

	// Sort top-to-bottom, left-to-right
	const boxCenterY = (b: { box: number[][] }) => {
		const ys = b.box.map(p => p[1]);
		return ys.reduce((a: number, b: number) => a + b, 0) / ys.length;
	};
	const boxCenterX = (b: { box: number[][] }) => {
		const xs = b.box.map(p => p[0]);
		return xs.reduce((a: number, b: number) => a + b, 0) / xs.length;
	};
	segments.sort((a, b) => {
		const ya = boxCenterY(a), yb = boxCenterY(b);
		if (Math.abs(ya - yb) > 20) return ya - yb;
		return boxCenterX(a) - boxCenterX(b);
	});

	const totalText = segments.map(s => s.text).join('');
	const totalMs = performance.now() - tStart;

	return { text: totalText, segments, detInferenceMs: detMs, postprocessMs: ppMs, recInferenceMs: recMs, totalMs };
}

// --- CLI ---
if (require.main === module) {
	(async () => {
		const imagePath = process.argv[2];
		if (!imagePath) {
			console.error('Usage: bun run subtitle-node.ts <image_path> [detEp=cpu|webgpu]');
			process.exit(1);
		}
		const detEp = process.argv[3] || 'cpu';
		const sessions = await createSessions(detEp);
		const result = await ocrFrameWithSessions(imagePath, sessions, { textScore: 0.3 });
		await releaseSessions(sessions);
		console.log(JSON.stringify(result, null, 2));
	})().catch(console.error);
}
