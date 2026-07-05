import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import {  STEM_FILE_NAMES, STEM_NAMES, type Stem } from './load';
import { DEMUCS_MODEL_DIR } from '@repo/config/path/models'
const HF_BASE_URL = 'https://huggingface.co/StemSplitio/htdemucs-ft-onnx/resolve/main';

export async function downloadDemucs(
  onProgress: (percent: number, message: string) => void,
  stems?: Stem[]
) {
  const targetStems = stems ?? [...STEM_NAMES];
  if (!existsSync(DEMUCS_MODEL_DIR)) {
    mkdirSync(DEMUCS_MODEL_DIR, { recursive: true });
  }

  const totalFiles = targetStems.length;
  let downloadedFiles = 0;

  for (const stem of targetStems) {
    const fileName = STEM_FILE_NAMES[stem];
    const filePath = join(DEMUCS_MODEL_DIR, fileName);
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
