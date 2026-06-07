import * as ort from 'onnxruntime-node';
import { AutoTokenizer } from '@huggingface/transformers';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readWav } from '../../wav.ts';
import type { TTSGenerateOptions, TTSGenerateResult, TTSBackend, VoxCPMNodeConfig, ModelStatus } from '../../types.ts';
import { VOXCPM_DIR } from '@repo/config';

const CFG = {
  patchSize: 4,
  featDim: 64,
  hiddenSize: 2048,
  baseNumLayers: 28,
  residualNumLayers: 8,
  numKvHeads: 2,
  kvChannels: 128,
  chunkSize: 640,
  sampleRate: 16000,
  outSampleRate: 48000,
  maxLen: 2000,
  minLen: 2000,  // effectively disables stop_flag (model's residual LM produces unreliable stop)
  defaultCfgValue: 2.0,
  audioStartToken: 101,
  audioEndToken: 102,
  refAudioStartToken: 103,
  refAudioEndToken: 104,
};

export function checkONNXStatus(modelDir: string): ModelStatus {
  const onnxFiles = [
    'voxcpm2_prefill.onnx',
    'voxcpm2_prefill.onnx.data',
    'voxcpm2_decode_step.onnx',
    'voxcpm2_decode_step.onnx.data',
    'audio_vae_decoder.onnx',
    'audio_vae_decoder.onnx.data',
    'audio_vae_encoder.onnx',
    'audio_vae_encoder.onnx.data',
  ];

  let onnxReady = true;
  for (const file of onnxFiles) {
    if (!existsSync(join(modelDir, file))) {
      onnxReady = false;
      break;
    }
  }

  return {
    exists: onnxReady,
    isReady: onnxReady,
    missingFiles: [],
  };
}

export async function checkONNXReady(): Promise<ModelStatus> {
  return checkONNXStatus(VOXCPM_DIR);
}

export class VoxCPMNodeONNX implements TTSBackend {
  readonly name = 'onnx-node';
  private vaeEnc?: ort.InferenceSession;
  private vaeDec?: ort.InferenceSession;
  private tokenizer?: any;
  private loaded = false;
  private transformerEp: ('cpu' | 'webgpu')[];
  private vaeEp: ('cpu' | 'webgpu')[];
  private modelDir: string;

  constructor(config: VoxCPMNodeConfig = {}) {
    this.modelDir = config.modelDir ?? VOXCPM_DIR;
    const ep = config.executionProvider ?? 'cpu';
    this.transformerEp = [ep];
    this.vaeEp = ep === 'webgpu' ? ['cpu'] : [ep];
  }

  async load(): Promise<void> {
    const status = checkONNXStatus(this.modelDir);
    if (!status.isReady) {
      throw new Error(`VoxCPM model not ready in ${this.modelDir}. Missing ONNX files.`);
    }

    console.log(`[VoxCPM] Loading VAE sessions (${this.vaeEp})...`);
    const vaeOpts: ort.InferenceSession.SessionOptions = { executionProviders: this.vaeEp };
    this.vaeEnc = await ort.InferenceSession.create(`${this.modelDir}/audio_vae_encoder.onnx`, vaeOpts);
    this.vaeDec = await ort.InferenceSession.create(`${this.modelDir}/audio_vae_decoder.onnx`, vaeOpts);

    console.log(`[VoxCPM] Loading tokenizer...`);
    this.tokenizer = await AutoTokenizer.from_pretrained(this.modelDir);

    this.loaded = true;
    console.log(`[VoxCPM] Ready.`);
  }

  async dispose(): Promise<void> {
    this.vaeEnc = undefined;
    this.vaeDec = undefined;
    this.tokenizer = undefined;
    this.loaded = false;
  }

  async generate(options: TTSGenerateOptions): Promise<TTSGenerateResult> {
    if (!this.loaded) throw new Error('Call load() first.');
    const tStart = performance.now();

    const cfg = options.cfgValue ?? CFG.defaultCfgValue;
    const minPatches = CFG.minLen;
    const sessionOpts = (ep: ('cpu' | 'webgpu')[]): ort.InferenceSession.SessionOptions => ({ executionProviders: ep });

    // 1. Encode reference WAV (VAE encoder, kept from load())
    const refFeat = await this._encodeWav(this.vaeEnc!, options.referenceWavPath);
    const tVaeEnc = performance.now();

    // 2. Tokenize text
    const textIds = await this._tokenize(options.text);
    const textLen = textIds.length;
    const autoMaxPatches = Math.max(20, Math.ceil(textLen * 6));
    const maxPatches = options.maxPatches ?? autoMaxPatches;
    const refPatches = Math.floor(refFeat.length / CFG.featDim);
    const totalLen = 2 + refPatches + textLen + 1;
    const zeroFeat = new Float32Array(CFG.featDim);

    const textTokens: bigint[] = [];
    const textMask: number[] = [];
    const featMask: number[] = [];
    const flatFeat = new Float32Array(totalLen * CFG.patchSize * CFG.featDim);

    function writeFeat(pos: number, feat: Float32Array) {
      flatFeat.set(feat, pos * CFG.patchSize * CFG.featDim);
    }

    function pushToken(tok: bigint, tMask: number, fMask: number, feat: Float32Array) {
      const pos = textTokens.length;
      textTokens.push(tok);
      textMask.push(tMask);
      featMask.push(fMask);
      writeFeat(pos, feat);
    }

    pushToken(BigInt(CFG.refAudioStartToken), 1, 0, zeroFeat);
    for (let i = 0; i < refPatches; i++) {
      const start = i * CFG.featDim;
      const patch = new Float32Array(refFeat.subarray(start, start + CFG.featDim));
      pushToken(0n, 0, 1, patch);
    }
    pushToken(BigInt(CFG.refAudioEndToken), 1, 0, zeroFeat);
    for (const id of textIds) {
      pushToken(BigInt(id), 1, 0, zeroFeat);
    }
    pushToken(BigInt(CFG.audioStartToken), 1, 0, zeroFeat);

    const seqLen = textTokens.length;

    // 3. Load Prefill → run → release
    const prefill = await ort.InferenceSession.create(`${this.modelDir}/voxcpm2_prefill.onnx`, sessionOpts(this.transformerEp));
    const prefillFeeds: Record<string, ort.Tensor> = {
      'text': new ort.Tensor('int64', BigInt64Array.from(textTokens), [1, seqLen]),
      'text_mask': new ort.Tensor('int32', new Int32Array(textMask), [1, seqLen]),
      'feat': new ort.Tensor('float32', flatFeat, [1, seqLen, CFG.patchSize, CFG.featDim]),
      'feat_mask': new ort.Tensor('int32', new Int32Array(featMask), [1, seqLen]),
    };
    const pfOut = await prefill.run(prefillFeeds);
    let ditHidden = pfOut['dit_hidden'] as ort.Tensor;
    let baseKeys = pfOut['base_next_keys'] as ort.Tensor;
    let baseVals = pfOut['base_next_values'] as ort.Tensor;
    let resKeys = pfOut['residual_next_keys'] as ort.Tensor;
    let resVals = pfOut['residual_next_values'] as ort.Tensor;
    let prefixCond = pfOut['prefix_feat_cond'] as ort.Tensor;
    // Deep copy prefill outputs
    ditHidden = new ort.Tensor('float32', new Float32Array((ditHidden).data as Float32Array), ditHidden.dims);
    baseKeys = new ort.Tensor('float32', new Float32Array((baseKeys).data as Float32Array), baseKeys.dims);
    baseVals = new ort.Tensor('float32', new Float32Array((baseVals).data as Float32Array), baseVals.dims);
    resKeys = new ort.Tensor('float32', new Float32Array((resKeys).data as Float32Array), resKeys.dims);
    resVals = new ort.Tensor('float32', new Float32Array((resVals).data as Float32Array), resVals.dims);
    prefixCond = new ort.Tensor('float32', new Float32Array((prefixCond).data as Float32Array), prefixCond.dims);
    await prefill.release();
    const tPrefill = performance.now();

    // 4. Load Decode → loop → release
    const decode = await ort.InferenceSession.create(`${this.modelDir}/voxcpm2_decode_step.onnx`, sessionOpts(this.transformerEp));
    const predPatches: Float32Array[] = [];

    for (let step = 0; step < maxPatches; step++) {
      const noise = new Float32Array(CFG.patchSize * CFG.featDim);
      for (let i = 0; i < noise.length; i++) {
        noise[i] = randn();
      }

      const decFeeds: Record<string, ort.Tensor> = {
        'dit_hidden': ditHidden,
        'base_next_keys': baseKeys,
        'base_next_values': baseVals,
        'residual_next_keys': resKeys,
        'residual_next_values': resVals,
        'prefix_feat_cond': prefixCond,
        'noise': new ort.Tensor('float32', noise, [1, CFG.patchSize, CFG.featDim]),
        'cfg_value': new ort.Tensor('float32', new Float32Array([cfg]), []),
      };

      const decOut = await decode.run(decFeeds);
      const predFeat = decOut['pred_feat'] as ort.Tensor;
      const pData = predFeat.data as Float32Array;
      const patch = new Float32Array(pData);
      predPatches.push(patch);

      // Deep copy for next iteration
      ditHidden = new ort.Tensor('float32', new Float32Array((decOut['new_dit_hidden_fixed'] as ort.Tensor).data as Float32Array), (decOut['new_dit_hidden_fixed'] as ort.Tensor).dims);
      baseKeys = new ort.Tensor('float32', new Float32Array((decOut['new_base_next_keys'] as ort.Tensor).data as Float32Array), (decOut['new_base_next_keys'] as ort.Tensor).dims);
      baseVals = new ort.Tensor('float32', new Float32Array((decOut['new_base_next_values'] as ort.Tensor).data as Float32Array), (decOut['new_base_next_values'] as ort.Tensor).dims);
      resKeys = new ort.Tensor('float32', new Float32Array((decOut['new_residual_next_keys_fixed'] as ort.Tensor).data as Float32Array), (decOut['new_residual_next_keys_fixed'] as ort.Tensor).dims);
      resVals = new ort.Tensor('float32', new Float32Array((decOut['new_residual_next_values_fixed'] as ort.Tensor).data as Float32Array), (decOut['new_residual_next_values_fixed'] as ort.Tensor).dims);
      prefixCond = new ort.Tensor('float32', new Float32Array(pData), [1, CFG.patchSize, CFG.featDim]);

      if (step >= minPatches) {
        const stopFlag = decOut['stop_flag'] as ort.Tensor;
        const stopData = stopFlag.data as Uint8Array;
        if (stopData[0] !== 0) break;
      }

      if (step % 20 === 19 || step === maxPatches - 1) {
        log(`Step ${step + 1}/${maxPatches}`);
      }
    }

    await decode.release();
    const tDecode = performance.now();

    // 5. VAE Decode (kept from load())
    const numPatches = predPatches.length;
    const zLen = numPatches * CFG.patchSize;
    const zData = new Float32Array(CFG.featDim * zLen);
    for (let t = 0; t < numPatches; t++) {
      const patch = predPatches[t];
      for (let p = 0; p < CFG.patchSize; p++) {
        for (let d = 0; d < CFG.featDim; d++) {
          zData[d * zLen + t * CFG.patchSize + p] = patch[p * CFG.featDim + d];
        }
      }
    }

    const aeOut = await this.vaeDec!.run({
      'z': new ort.Tensor('float32', zData, [1, CFG.featDim, zLen]),
    });
    const audioTensor = aeOut['audio'] as ort.Tensor;
    const audioData = audioTensor.data as Float32Array;
    const tVaeDec = performance.now();

    const duration = audioData.length / CFG.outSampleRate;
    const totalMs = tVaeDec - tStart;
    const rtf = totalMs / (duration * 1000);
    log(`Generated ${audioData.length} samples (${duration.toFixed(2)}s) in ${(totalMs / 1000).toFixed(1)}s | RTF ${rtf.toFixed(2)}`);

    const genTimeSec = (performance.now() - tStart) / 1000;
    return { samples: audioData, loadTimeSec: 0, genTimeSec };
  }

  private async _tokenize(text: string): Promise<number[]> {
    const result = await this.tokenizer!(text);
    const ids = Array.from(result.input_ids.data as bigint[]).map(Number);

    const splitMap = this._buildSplitMap();
    const expanded: number[] = [];
    for (const id of ids) {
      const expansion = splitMap.get(id);
      if (expansion) {
        expanded.push(...expansion);
      } else {
        expanded.push(id);
      }
    }
    return expanded;
  }

  private _buildSplitMap(): Map<number, number[]> {
    const map = new Map<number, number[]>();
    const vocab = (this.tokenizer as any).get_vocab?.() as Record<string, number> | undefined;
    if (!vocab) return map;

    for (const [token, tid] of Object.entries(vocab)) {
      const clean = token.replace('\u2581', '');
      if (clean.length >= 2 && [...clean].every(c => _isCjk(c))) {
        const charIds = [...clean].map(c => vocab[c]).filter(id => id !== undefined);
        if (charIds.length === clean.length) {
          map.set(tid, charIds);
        }
      }
    }
    return map;
  }

  private async _encodeWav(session: ort.InferenceSession, wavPath: string): Promise<Float32Array> {
    const { samples, sampleRate } = readWav(wavPath);
    let audio = samples;

    if (sampleRate !== CFG.sampleRate) {
      audio = _resample(audio, sampleRate, CFG.sampleRate);
    }

    const patchLen = CFG.patchSize * CFG.chunkSize;
    if (audio.length % patchLen !== 0) {
      const padSize = patchLen - (audio.length % patchLen);
      const padded = new Float32Array(audio.length + padSize);
      padded.set(audio);
      audio = padded;
    }

    const encOut = await session.run({
      'audio_data': new ort.Tensor('float32', audio, [1, 1, audio.length]),
    });
    const z = encOut['z'] as ort.Tensor;
    const zData = z.data as Float32Array;

    const D = CFG.featDim;
    const T = zData.length / D;
    const P = CFG.patchSize;
    const numPatches = Math.floor(T / P);
    const feat = new Float32Array(numPatches * P * D);

    for (let ti = 0; ti < numPatches; ti++) {
      for (let p = 0; p < P; p++) {
        for (let d = 0; d < D; d++) {
          feat[ti * P * D + p * D + d] = zData[d * T + ti * P + p] || 0;
        }
      }
    }

    return feat;
  }
}

let _logFn: (msg: string) => void = console.log;

export function setLogger(fn: (msg: string) => void) {
  _logFn = fn;
}

function log(msg: string) {
  _logFn(`[VoxCPM] ${msg}`);
}

function _resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = toRate / fromRate;
  const outLen = Math.round(input.length * ratio);
  const output = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[Math.min(idx, input.length - 1)] ?? 0;
    const b = input[Math.min(idx + 1, input.length - 1)] ?? 0;
    output[i] = a + (b - a) * frac;
  }
  return output;
}

function _isCjk(c: string): boolean {
  const code = c.charCodeAt(0);
  return (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0xf900 && code <= 0xfaff);
}

function randn(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
