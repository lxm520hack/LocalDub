import * as ort from 'onnxruntime-node';
import { readFileSync, writeFileSync } from 'node:fs';
import { checkDemucsStatus, STEM_FILE_NAMES, STEM_NAMES, type Stem } from './load';
import { DEMUCS_MODEL_DIR } from '@repo/config/path/models';

const SAMPLE_RATE = 44100;
const SEGMENT_LEN = 343980;
const HOP_LEN = SEGMENT_LEN >> 1;
const NUM_CHANNELS = 2;

const HANN_WINDOW = (() => {
  const w = new Float32Array(SEGMENT_LEN);
  for (let i = 0; i < SEGMENT_LEN; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (SEGMENT_LEN - 1)));
  }
  return w;
})();

export interface DemucsStems {
  drums: Float32Array;
  bass: Float32Array;
  other: Float32Array;
  vocals: Float32Array;
  sampleRate: number;
}

export class Demucs {
  private sessions?: Map<Stem, ort.InferenceSession>;
  private loaded = false;
  private stems: readonly Stem[];

  constructor(
    private modelDir: string = DEMUCS_MODEL_DIR,
    private options?: { executionProvider?: 'cpu' | 'webgpu'; stems?: readonly Stem[] },
  ) {
    this.stems = options?.stems ?? ['vocals'];
  }

  async load() {
    const status = await checkDemucsStatus(this.stems);
    if (!status.isReady) {
      throw new Error(`Demucs model not ready in ${this.modelDir}. Missing ONNX files.`);
    }

    const ep = this.options?.executionProvider ?? 'cpu';
    console.log(`[Demucs] Loading ${this.stems.length} ONNX bag session(s) (${ep}): ${this.stems.join(',')}...`);
    const sessions = new Map<Stem, ort.InferenceSession>();
    for (const stem of this.stems) {
      sessions.set(stem, await ort.InferenceSession.create(
        `${this.modelDir}/${STEM_FILE_NAMES[stem]}`,
        { executionProviders: [ep] },
      ));
    }
    this.sessions = sessions;
    this.loaded = true;
    console.log(`[Demucs] Ready.`);
  }

  async separate(audioPath: string): Promise<DemucsStems> {
    if (!this.loaded) throw new Error('Call load() first.');
    return this._separateFile(audioPath);
  }

  async separateAudio(audioData: Float32Array, sampleRate: number): Promise<DemucsStems> {
    if (!this.loaded) throw new Error('Call load() first.');
    return this._separateBuffer(audioData, sampleRate);
  }

  writeWav(stereoAudio: Float32Array, sampleRate: number, filePath: string) {
    const bitsPerSample = 16;
    const byteRate = sampleRate * NUM_CHANNELS * (bitsPerSample / 8);
    const blockAlign = NUM_CHANNELS * (bitsPerSample / 8);
    const dataSize = stereoAudio.length * (bitsPerSample / 8);
    const headerSize = 44;
    const buf = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(buf);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    const writeU16 = (offset: number, v: number) => view.setUint16(offset, v, true);
    const writeU32 = (offset: number, v: number) => view.setUint32(offset, v, true);

    writeStr(0, 'RIFF');
    writeU32(4, 36 + dataSize);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    writeU32(16, 16);
    writeU16(20, 1);
    writeU16(22, NUM_CHANNELS);
    writeU32(24, sampleRate);
    writeU32(28, byteRate);
    writeU16(32, blockAlign);
    writeU16(34, bitsPerSample);
    writeStr(36, 'data');
    writeU32(40, dataSize);

    const samples = new Int16Array(buf, headerSize, stereoAudio.length);
    for (let i = 0; i < stereoAudio.length; i++) {
      const s = Math.max(-1, Math.min(1, stereoAudio[i]));
      samples[i] = Math.round(s * 32767);
    }

    writeFileSync(filePath, new Uint8Array(buf));
  }

  private async _separateFile(path: string): Promise<DemucsStems> {
    const buf = readFileSync(path);
    const { audio, sampleRate } = this._readWav(buf);
    return this._separateBuffer(audio, sampleRate);
  }

  private async _separateBuffer(input: Float32Array, sampleRate: number): Promise<DemucsStems> {
    let audio = input;
    if (sampleRate !== SAMPLE_RATE) {
      audio = this._resample(audio, sampleRate, SAMPLE_RATE);
    }

    const totalSamples = audio.length / NUM_CHANNELS;

    // Normalize via mono mix → scalar mean/std (match PyTorch api.py)
    const mono = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      let chSum = 0;
      for (let c = 0; c < NUM_CHANNELS; c++) {
        chSum += audio[i * NUM_CHANNELS + c];
      }
      mono[i] = chSum / NUM_CHANNELS;
    }
    let monoSum = 0;
    for (let i = 0; i < totalSamples; i++) monoSum += mono[i];
    const normMean = monoSum / totalSamples;
    let sqSum = 0;
    for (let i = 0; i < totalSamples; i++) sqSum += (mono[i] - normMean) ** 2;
    const normStd = Math.sqrt(sqSum / totalSamples);
    const normEps = 1e-8;
    for (let i = 0; i < audio.length; i++) {
      audio[i] = (audio[i] - normMean) / (normStd + normEps);
    }

    const requestedSet = new Set<Stem>(this.stems);
    const outStems: Float32Array[] = STEM_NAMES.map(stem =>
      requestedSet.has(stem) ? new Float32Array(totalSamples * NUM_CHANNELS) : new Float32Array(0)
    );
    const outWeight = new Float32Array(totalSamples * NUM_CHANNELS);

    const numSegments = Math.max(1, Math.ceil((totalSamples - SEGMENT_LEN) / HOP_LEN) + 1);

    for (let seg = 0; seg < numSegments; seg++) {
      const offset = seg * HOP_LEN;

      let segLen = SEGMENT_LEN;
      let pad = 0;
      if (offset + SEGMENT_LEN > totalSamples) {
        pad = offset + SEGMENT_LEN - totalSamples;
        segLen = totalSamples - offset;
      }

      const segBuf = new Float32Array(SEGMENT_LEN * NUM_CHANNELS);
      for (let c = 0; c < NUM_CHANNELS; c++) {
        for (let i = 0; i < segLen; i++) {
          segBuf[c * SEGMENT_LEN + i] = audio[(offset + i) * NUM_CHANNELS + c] ?? 0;
        }
      }

      const inputTensor = new ort.Tensor('float32', segBuf, [1, NUM_CHANNELS, SEGMENT_LEN]);

      for (const stem of this.stems) {
        const targetIdx = STEM_NAMES.indexOf(stem);
        const stemOut = outStems[targetIdx];
        const session = this.sessions!.get(stem)!;
        const result = await session.run({ 'mix': inputTensor });
        const allStems = (result['stems'] as ort.Tensor).data as Float32Array;

        for (let c = 0; c < NUM_CHANNELS; c++) {
          for (let i = 0; i < segLen; i++) {
            const idx = offset + i;
            const win = HANN_WINDOW[i];
            const srcIdx = targetIdx * NUM_CHANNELS * SEGMENT_LEN + c * SEGMENT_LEN + i;
            const dstIdx = idx * NUM_CHANNELS + c;
            stemOut[dstIdx] += allStems[srcIdx] * win;
            outWeight[dstIdx] += win;
          }
        }
      }

      if (pad > 0) break;

      if (seg % 10 === 0) {
        console.log(`[Demucs] Segment ${seg + 1}/${numSegments}`);
      }
    }

    for (const stem of this.stems) {
      const targetIdx = STEM_NAMES.indexOf(stem);
      const stemOut = outStems[targetIdx];
      for (let i = 0; i < stemOut.length; i++) {
        if (outWeight[i] > 1e-6) {
          stemOut[i] /= outWeight[i];
        }
      }
    }

    // Un-normalize back to original scale (only for requested stems)
    for (const stem of this.stems) {
      const targetIdx = STEM_NAMES.indexOf(stem);
      const stemOut = outStems[targetIdx];
      for (let i = 0; i < stemOut.length; i++) {
        stemOut[i] = stemOut[i] * (normStd + normEps) + normMean;
      }
    }

    return {
      drums: outStems[0],
      bass: outStems[1],
      other: outStems[2],
      vocals: outStems[3],
      sampleRate: SAMPLE_RATE,
    };
  }

  private _readWav(buf: Buffer): { audio: Float32Array; sampleRate: number } {
    const sampleRate = buf.readUInt32LE(24);
    const numChannels = buf.readUInt16LE(22);
    const bitsPerSample = buf.readUInt16LE(34);
    const bytesPerSample = bitsPerSample / 8;

    let dataStart = 0;
    let dataSize = 0;
    let pos = 12;
    while (pos + 8 <= buf.length) {
      const chunkId = buf.toString('ascii', pos, pos + 4);
      const chunkSize = buf.readUInt32LE(pos + 4);
      if (chunkId === 'data') {
        dataStart = pos + 8;
        dataSize = chunkSize;
        break;
      }
      pos += 8 + chunkSize + (chunkSize % 2);
    }
    if (dataSize === 0) throw new Error('No data chunk found in WAV');

    const numSamples = dataSize / bytesPerSample;

    let audio: Float32Array;
    if (bitsPerSample === 16) {
      audio = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        audio[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
      }
    } else if (bitsPerSample === 32) {
      audio = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        audio[i] = buf.readFloatLE(dataStart + i * 4);
      }
    } else {
      throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`);
    }

    if (numChannels !== NUM_CHANNELS) {
      const stereo = new Float32Array((audio.length / numChannels) * NUM_CHANNELS);
      for (let i = 0; i < audio.length / numChannels; i++) {
        const mono = audio[i * numChannels];
        stereo[i * 2] = mono;
        stereo[i * 2 + 1] = mono;
      }
      audio = stereo;
    }

    return { audio, sampleRate };
  }

  private _resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
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
}
