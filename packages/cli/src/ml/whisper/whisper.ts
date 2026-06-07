import { join } from 'node:path';
import { InferenceSession, Tensor } from 'onnxruntime-node';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SHERPA_WHISPER_DIR } from '@repo/config';

const VOCAB_SIZE = 51866;
const DECODER_START_TOKEN = 50258;
const EOS_TOKEN = 50257;
// Derived empirically: after SOT(50258), model outputs task token(50360) then first timestamp(50364).
// 50364 = TIMESTAMP_BEGIN → <|0.00|>. Each increment = 20ms. Range: 50364-51865 (1502 timestamps, ~30s).
const TIMESTAMP_BEGIN = 50364;
const TIME_PER_TOKEN_MS = 20;

let encoderSession: InferenceSession | null = null;
let decoderSession: InferenceSession | null = null;

async function loadSessions() {
	if (!encoderSession) {
		encoderSession = await InferenceSession.create(
			join(SHERPA_WHISPER_DIR, 'turbo-encoder.int8.onnx'),
			{ executionProviders: ['cpu'] },
		);
	}
	if (!decoderSession) {
		decoderSession = await InferenceSession.create(
			join(SHERPA_WHISPER_DIR, 'turbo-decoder.int8.onnx'),
			{ executionProviders: ['cpu'] },
		);
	}
	return { encoderSession, decoderSession };
}

// ---- Mel spectrogram (whisper convention: n_fft=400, hop=160, 128 bins, 16kHz) ----
function hannWindow(n: number): Float64Array {
	const w = new Float64Array(n);
	for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
	return w;
}

function melFilterbank(nMel: number, nFft: number, sr: number): Float64Array[] {
	const fMin = 0, fMax = sr / 2;
	const melMin = 2595 * Math.log10(1 + fMin / 700);
	const melMax = 2595 * Math.log10(1 + fMax / 700);
	const pts = new Float64Array(nMel + 2);
	for (let i = 0; i < nMel + 2; i++) pts[i] = melMin + (melMax - melMin) * i / (nMel + 1);
	const hz = [...pts].map(m => 700 * (10 ** (m / 2595) - 1));
	const bins = hz.map(h => Math.floor((nFft + 1) * h / sr));
	const banks: Float64Array[] = [];
	for (let i = 0; i < nMel; i++) {
		const bank = new Float64Array(nFft / 2 + 1);
		const l = bins[i], c = bins[i + 1], r = bins[i + 2];
		if (c > l) for (let j = l; j < c; j++) bank[j] = (j - l) / (c - l);
		if (r > c) for (let j = c; j <= r; j++) bank[j] = (r - j) / (r - c);
		banks.push(bank);
	}
	return banks;
}

function stftMagnitude(frame: Float64Array, nFft: number): Float64Array {
	const mag2 = new Float64Array(nFft / 2 + 1);
	for (let k = 0; k <= nFft / 2; k++) {
		let re = 0, im = 0;
		for (let i = 0; i < nFft; i++) {
			const a = -2 * Math.PI * k * i / nFft;
			re += frame[i] * Math.cos(a);
			im += frame[i] * Math.sin(a);
		}
		mag2[k] = re * re + im * im;
	}
	return mag2;
}

function computeLogMel(pcm: Float32Array, sr: number, nFft: number, hop: number, nMel: number): Float32Array {
	const win = hannWindow(nFft);
	const banks = melFilterbank(nMel, nFft, sr);
	const nFrames = Math.max(Math.floor((pcm.length - nFft + hop) / hop), 0);
	if (nFrames === 0) throw new Error(`Audio too short: ${pcm.length} samples`);
	const mel = new Float64Array(nMel * nFrames);
	for (let i = 0; i < nFrames; i++) {
		const start = i * hop;
		const frame = new Float64Array(nFft);
		for (let j = 0; j < nFft; j++) {
			frame[j] = (start + j < pcm.length ? pcm[start + j] : 0) * win[j];
		}
		const mag2 = stftMagnitude(frame, nFft);
		for (let m = 0; m < nMel; m++) {
			let sum = 0;
			for (let k = 0; k < mag2.length; k++) sum += mag2[k] * banks[m][k];
			mel[i * nMel + m] = Math.log10(Math.max(sum, 1e-10));
		}
	}
	for (let m = 0; m < nMel; m++) {
		let sum = 0, sq = 0;
		for (let i = 0; i < nFrames; i++) { const v = mel[i * nMel + m]; sum += v; sq += v * v; }
		const mean = sum / nFrames;
		const std = Math.sqrt(Math.max(sq / nFrames - mean * mean, 1e-10));
		for (let i = 0; i < nFrames; i++) mel[i * nMel + m] = (mel[i * nMel + m] - mean) / std;
	}
	const out = new Float32Array(nMel * 3000);
	for (let m = 0; m < nMel; m++)
		for (let i = 0; i < nFrames; i++)
			out[m * 3000 + i] = mel[i * nMel + m];
	return out;
}

function loadAudio(filePath: string): Float32Array {
	const r = spawnSync('ffmpeg', [
		'-i', filePath, '-f', 'f32le', '-acodec', 'pcm_f32le',
		'-ar', '16000', '-ac', '1', '-',
	], { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
	if (r.error) throw new Error(`ffmpeg: ${r.error.message}`);
	if (r.status !== 0) throw new Error(`ffmpeg exit ${r.status}`);
	return new Float32Array(r.stdout.buffer);
}

// ---- Token decoding ----
let _tokenStrings: string[] | null = null;

function loadTokens(): string[] {
	if (!_tokenStrings) {
		const text = readFileSync(join(SHERPA_WHISPER_DIR, 'turbo-tokens.txt'), 'utf-8');
		_tokenStrings = text.trim().split('\n').map(l => l.split(' ')[0]);
	}
	return _tokenStrings;
}

// ---- Inference ----
export interface WhisperSegment {
	start: number;
	end: number;
	text: string;
}

export async function transcribe(audioPath: string): Promise<WhisperSegment[]> {
	const { encoderSession: enc, decoderSession: dec } = await loadSessions();

	const pcm = loadAudio(audioPath);
	const mel = computeLogMel(pcm, 16000, 400, 160, 128);

	const melTensor = new Tensor('float32', mel, [1, 128, 3000]);
	const { n_layer_cross_k, n_layer_cross_v } = await enc.run({ mel: melTensor });

	const allTokens: number[] = [];
	const B = BigInt64Array;
	const F32 = Float32Array;

	const maxSeq = 448;
	const dModel = 1280;
	const nLayers = 4;
	const batch = 1;

	const initSelfK = new Tensor('float32', new F32(nLayers * batch * maxSeq * dModel), [nLayers, batch, maxSeq, dModel]);
	const initSelfV = new Tensor('float32', new F32(nLayers * batch * maxSeq * dModel), [nLayers, batch, maxSeq, dModel]);

	let selfK: Tensor = initSelfK;
	let selfV: Tensor = initSelfV;

	for (let step = 0; step < maxSeq; step++) {
		const tokenId = step === 0 ? DECODER_START_TOKEN : allTokens[step - 1];

		const feeds: Record<string, Tensor> = {
			tokens: new Tensor('int64', B.from([BigInt(tokenId)]), [1, 1]),
			in_n_layer_self_k_cache: selfK,
			in_n_layer_self_v_cache: selfV,
			n_layer_cross_k,
			n_layer_cross_v,
			offset: new Tensor('int64', B.from([BigInt(step)]), [1]),
		};

		const outputs = await dec.run(feeds);
		const logits = outputs.logits.data as Float32Array;
		const lastLogits = logits.slice(logits.length - VOCAB_SIZE);

		let maxVal = -Infinity, nextToken = 0;
		for (let i = 0; i < lastLogits.length; i++) {
			if (lastLogits[i] > maxVal) { maxVal = lastLogits[i]; nextToken = i; }
		}

		if (nextToken === EOS_TOKEN) break;
		allTokens.push(nextToken);

		selfK = outputs.out_n_layer_self_k_cache;
		selfV = outputs.out_n_layer_self_v_cache;
	}

	const segments = decodeTimestamps(allTokens);
	if (segments.length === 0) {
		return [{ start: 0, end: 0, text: '' }];
	}
	return segments;
}

function decodeTimestamps(tokens: number[]): WhisperSegment[] {
	const tokenStrings = loadTokens();
	const segments: WhisperSegment[] = [];
	let currentBytes: number[] = [];
	let currentStart = 0;
	let gotFirstTimestamp = false;

	function flushSegment(endTs: number) {
		if (currentBytes.length === 0) return;
		const text = new TextDecoder('utf-8', { fatal: false }).decode(
			new Uint8Array(currentBytes),
		).trim();
		if (text) {
			segments.push({ start: currentStart, end: endTs, text });
		}
		currentBytes = [];
	}

	for (const id of tokens) {
		if (id >= TIMESTAMP_BEGIN) {
			const ts = (id - TIMESTAMP_BEGIN) * TIME_PER_TOKEN_MS;
			if (!gotFirstTimestamp) {
				currentStart = ts;
				gotFirstTimestamp = true;
				continue;
			}
			// End of previous segment, start of new one
			flushSegment(ts);
			currentStart = ts;
		} else if (id < 50257) {
			// Text token — decode from base64
			const b64 = tokenStrings[id];
			if (b64 && b64 !== '=') {
				try {
					const raw = Buffer.from(b64, 'base64');
					currentBytes.push(...raw);
				} catch { /* ignore bad tokens */ }
			}
		}
		// IDs 50257-50363 are special tokens (language, task, notimestamps) — skip
	}

	if (currentBytes.length > 0) {
		if (gotFirstTimestamp) {
			flushSegment(currentStart + 500);
		} else {
			// No timestamps in output — return full text as one segment
			const text = new TextDecoder('utf-8', { fatal: false }).decode(
				new Uint8Array(currentBytes),
			).trim();
			if (text) segments.push({ start: 0, end: 0, text });
		}
	}
	return segments;
}

export async function release() {
	if (encoderSession) { await encoderSession.release(); encoderSession = null; }
	if (decoderSession) { await decoderSession.release(); decoderSession = null; }
}
