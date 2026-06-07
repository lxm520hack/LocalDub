import { Demucs } from './demucs';
import { checkDemucsStatus } from './load';

async function main() {
  const status = await checkDemucsStatus();
  console.log('Model status:', JSON.stringify(status, null, 2));

  if (!status.isReady) {
    console.log('Model not ready. Run download first.');
    return;
  }

  const inputFile = process.argv[2];
  if (!inputFile) {
    console.log('Usage: bun run packages/api/src/ml/demucs/run.ts <audio.wav>');
    console.log('Downloads and tests the model if no audio provided.');
    return;
  }

  const outputDir = process.argv[3] || '.';
  const ep = (process.argv[4] || 'cpu') as 'cpu' | 'webgpu';

  console.log(`[Demucs] Separating: ${inputFile}`);
  console.log(`[Demucs] Output dir: ${outputDir}`);
  console.log(`[Demucs] Provider: ${ep}`);

  const demucs = new Demucs(undefined, { executionProvider: ep });
  await demucs.load();

  const stems = await demucs.separate(inputFile);

  for (const name of ['drums', 'bass', 'other', 'vocals'] as const) {
    const path = `${outputDir}/${name}.wav`;
    demucs.writeWav(stems[name], stems.sampleRate, path);
    console.log(`[Demucs] Wrote: ${path}`);
  }

  const bgm = new Float32Array(stems.drums.length);
  for (let i = 0; i < bgm.length; i++) {
    bgm[i] = stems.drums[i] + stems.bass[i] + stems.other[i];
  }
  demucs.writeWav(bgm, stems.sampleRate, `${outputDir}/bgm.wav`);
  console.log('[Demucs] Wrote: bgm.wav');

  console.log('[Demucs] Done!');
}

main().catch(console.error);
