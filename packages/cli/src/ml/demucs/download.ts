import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { DEMUCS_MODEL_PATH } from './load';

const HF_BASE_URL = 'https://huggingface.co/StemSplitio/htdemucs-ft-onnx/resolve/main';

const FILES_TO_DOWNLOAD = [
  'htdemucs_ft_vocals.onnx',
];

export async function downloadDemucs(onProgress: (percent: number, message: string) => void) {
  if (!existsSync(DEMUCS_MODEL_PATH)) {
    mkdirSync(DEMUCS_MODEL_PATH, { recursive: true });
  }

  const totalFiles = FILES_TO_DOWNLOAD.length;
  let downloadedFiles = 0;

  for (const fileName of FILES_TO_DOWNLOAD) {
    const filePath = join(DEMUCS_MODEL_PATH, fileName);
    const url = `${HF_BASE_URL}/${fileName}?download=true`;

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
            ((downloadedFiles + receivedLength / contentLength) / totalFiles) * 100
          );
          if (receivedLength % (1024 * 1024 * 5) < (value?.length ?? 0)) {
            onProgress(overallPercent, `Downloading ${fileName}: ${Math.floor(filePercent)}%`);
          }
        }
      }

      writer.end();
      downloadedFiles++;

      onProgress(
        Math.floor((downloadedFiles / totalFiles) * 100),
        `Finished ${fileName}`
      );
    } catch (error) {
      console.error(`Error downloading ${fileName}:`, error);
      throw error;
    }
  }

  onProgress(100, "All models downloaded successfully.");
}
