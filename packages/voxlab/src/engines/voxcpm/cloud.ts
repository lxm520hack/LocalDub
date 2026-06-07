import { Client, handle_file } from '@gradio/client';
import type { TTSGenerateOptions, TTSGenerateResult, TTSBackend, VoxCPMCloudConfig } from '../../types.ts';

const DEFAULT_API_URL = 'https://voxcpm.modelbest.cn';

function parseWav(buf: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(buf);
  let offset = 12;
  let sampleRate = 48000;
  const readStr = (pos: number, len: number) =>
    Array.from(new Uint8Array(buf, pos, len), (c) => String.fromCharCode(c)).join('');

  while (offset + 8 <= buf.byteLength) {
    const chunkId = readStr(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 'fmt ') {
      sampleRate = view.getUint32(offset + 12, true);
    } else if (chunkId === 'data') {
      const dataStart = offset + 8;
      const pcmCount = Math.min(chunkSize, buf.byteLength - dataStart) >> 1;
      const int16 = new Int16Array(buf, dataStart, pcmCount);
      const samples = new Float32Array(pcmCount);
      for (let i = 0; i < pcmCount; i++) {
        samples[i] = int16[i] / 32768;
      }
      return { samples, sampleRate };
    }
    offset += 8 + chunkSize + (chunkSize & 1);
  }
  // No 'data' chunk found — treat entire buffer as raw PCM (fallback)
  const pcmCount = buf.byteLength >> 1;
  const int16 = new Int16Array(buf);
  const samples = new Float32Array(pcmCount);
  for (let i = 0; i < pcmCount; i++) {
    samples[i] = int16[i] / 32768;
  }
  return { samples, sampleRate: 48000 };
}

function resample(src: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return src;
  const ratio = toRate / fromRate;
  const len = Math.ceil(src.length * ratio);
  const dst = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const pos = i / ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    dst[i] = idx + 1 < src.length
      ? src[idx] * (1 - frac) + src[idx + 1] * frac
      : src[Math.min(idx, src.length - 1)];
  }
  return dst;
}

export class VoxCPMCloud implements TTSBackend {
  readonly name = 'cloud';
  private client?: InstanceType<typeof Client>;
  private config: VoxCPMCloudConfig;

  constructor(config: VoxCPMCloudConfig = {}) {
    this.config = config;
  }

  async load(): Promise<void> {
    const url = this.config.apiUrl ?? DEFAULT_API_URL;
    console.log(`[VoxCPM] Connecting to ${url}...`);
    this.client = await Client.connect(url);
    console.log(`[VoxCPM] Connected.`);
  }

  async dispose(): Promise<void> {
    this.client = undefined;
  }

  async generate(options: TTSGenerateOptions): Promise<TTSGenerateResult> {
    if (!this.client) throw new Error('Call load() first.');
    const tStart = performance.now();

    const cfg = options.cfgValue ?? 2.0;

    // Fix 1: Pass file path string (not Buffer) so Gradio client reads it directly
    let refFile: unknown = null;
    let isUltimate = false;
    const promptText = options.promptText ?? '';
    if (options.referenceWavPath) {
      refFile = handle_file(options.referenceWavPath);
    }

    const result = await this.client.predict('/generate', [
      options.text,
      this.config.controlInstruction ?? '',
      refFile,               // reference_audio (FileData | null)
      isUltimate,            // ultimate cloning mode
      promptText,            // Fix 2: now has the reference audio's transcription
      cfg,                   // cfg_value
      false,                 // normalize
      false,                 // ref_denoise
      10,                    // dit_steps
      '',
    ]);

    const genTime = (performance.now() - tStart) / 1000;

    const data = result.data as unknown as Array<{ url?: string; path?: string }>;
    const audioFile = data[0];
    const audioUrl = audioFile.url ?? audioFile.path;
    if (!audioUrl) throw new Error('No audio URL in response');

    const resp = await fetch(audioUrl);
    const buf = await resp.arrayBuffer();

    // Fix 3: Parse WAV header to find data chunk offset (skip RIFF header garbage)
    let { samples, sampleRate } = parseWav(buf);
    if (sampleRate !== 48000) {
      samples = resample(samples, sampleRate, 48000);
    }

    return { samples, loadTimeSec: 0, genTimeSec: genTime };
  }
}
