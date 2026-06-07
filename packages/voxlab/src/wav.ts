import { readFileSync, writeFileSync } from 'node:fs';

export function writeWav(samples: Float32Array, filePath: string, sampleRate: number): void {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  const scale = peak > 1e-6 ? 0.95 * 32768 / peak : 1;

  const buf = new ArrayBuffer(44 + samples.length * 2);
  const dv = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeStr(36, 'data');
  dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-32768, Math.min(32767, Math.round(samples[i] * scale)));
    dv.setInt16(44 + i * 2, s, true);
  }
  writeFileSync(filePath, new Uint8Array(buf));
}

export function readWav(filePath: string): { samples: Float32Array; sampleRate: number } {
  const buf = readFileSync(filePath);

  // Find "data" chunk by scanning RIFF chunks
  let dataStart = 44;
  for (let i = 12; i < buf.length - 8;) {
    const chunkId = buf.toString('utf8', i, i + 4);
    const chunkSize = buf.readUInt32LE(i + 4);
    if (chunkId === 'data') {
      dataStart = i + 8;
      break;
    }
    i += 8 + chunkSize + (chunkSize % 2);
  }

  const sampleRate = buf.readUInt32LE(24);
  const numChannels = buf.readUInt16LE(22);
  const bitsPerSample = buf.readUInt16LE(34);
  const dataLength = buf.length - dataStart;

  let audio: Float32Array;

  if (bitsPerSample === 16) {
    const samples = new Int16Array(buf.buffer, buf.byteOffset + dataStart, dataLength / 2);
    audio = new Float32Array(samples.length / numChannels);
    for (let i = 0; i < audio.length; i++) {
      audio[i] = samples[i * numChannels] / 32768;
    }
  } else if (bitsPerSample === 32) {
    const samples = new Float32Array(buf.buffer, buf.byteOffset + dataStart, dataLength / 4);
    audio = new Float32Array(samples.length / numChannels);
    for (let i = 0; i < audio.length; i++) {
      audio[i] = samples[i * numChannels];
    }
  } else {
    throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`);
  }

  return { samples: audio, sampleRate };
}
