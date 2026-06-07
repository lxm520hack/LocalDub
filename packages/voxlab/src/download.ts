import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { VOXCPM_DIR } from '@repo/config';

const HF_BASE_URL = 'https://huggingface.co/ai4all8/VoxCPM2-ONNX/resolve/main';

const FILES_TO_DOWNLOAD = [
  'voxcpm2_prefill.onnx',
  'voxcpm2_prefill.onnx.data',
  'voxcpm2_decode_step.onnx',
  'voxcpm2_decode_step.onnx.data',
  'audio_vae_decoder.onnx',
  'audio_vae_decoder.onnx.data',
  'audio_vae_encoder.onnx',
  'audio_vae_encoder.onnx.data',
];

export async function downloadVoxCPM(onProgress: (percent: number, message: string) => void): Promise<void> {
  const modelDir = VOXCPM_DIR;
  if (!existsSync(modelDir)) {
    mkdirSync(modelDir, { recursive: true });
  }

  const totalFiles = FILES_TO_DOWNLOAD.length;
  let downloadedFiles = 0;

  for (const fileName of FILES_TO_DOWNLOAD) {
    const filePath = join(modelDir, fileName);
    const url = `${HF_BASE_URL}/${fileName}?download=true`;

    onProgress(
      Math.floor((downloadedFiles / totalFiles) * 100),
      `Downloading ${fileName}...`,
    );

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download ${fileName}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error(`Failed to get reader for ${fileName}`);

      const contentLength = +(response.headers.get('Content-Length') ?? 0);
      let receivedLength = 0;

      const file = Bun.file(filePath);
      const writer = file.writer();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        writer.write(value);
        receivedLength += value.length;

        if (contentLength > 0) {
          const filePercent = (receivedLength / contentLength) * 100;
          const overallPercent = Math.floor(
            ((downloadedFiles + receivedLength / contentLength) / totalFiles) * 100,
          );
          if (receivedLength % (1024 * 1024 * 5) < value.length) {
            onProgress(overallPercent, `Downloading ${fileName}: ${Math.floor(filePercent)}%`);
          }
        }
      }

      writer.end();
      downloadedFiles++;

      onProgress(
        Math.floor((downloadedFiles / totalFiles) * 100),
        `Finished ${fileName}`,
      );
    } catch (error) {
      console.error(`Error downloading ${fileName}:`, error);
      throw error;
    }
  }

  onProgress(100, 'All models downloaded successfully.');
}
