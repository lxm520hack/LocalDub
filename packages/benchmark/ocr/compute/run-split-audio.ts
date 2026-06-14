import { Context, writeCtx } from '../../../cli/src/feat/context/context';
import { stageSplitAudio } from '../../../cli/src/feat/stages/split_audio';
import { ensureDir } from '../../../cli/src/feat/stages/utils/fileOps';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const label = process.argv[2];
if (!label) { console.error('Usage: bun run-split-audio.ts <results/label>'); process.exit(1); }

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const resultDir = resolve(__dirname, '..', 'results', label);
const metadataDir = join(resultDir, 'metadata');
const srtPath = join(metadataDir, 'asr_ocr_fix.json');
const audioSource = resolve(REPO_ROOT, 'packages', 'tmp', 'raw-audio.wav');

if (!existsSync(srtPath)) throw new Error(`not found: ${srtPath}`);
if (!existsSync(audioSource)) throw new Error(`not found: ${audioSource}`);

const ctx: Context = {
  task: { id: 'benchmark-split', source: 'local', url: '', status: 'running', session_path: resultDir, created_at: new Date().toISOString(), current_stage: 'split_audio' },
  pipeline: 'dub',
  input: { stages: { translate: { enabled: false }, split_audio: { vadAlign: false } } },
};
writeCtx(ctx);
ensureDir(join(resultDir, 'segments', 'vocals'), ctx);

await stageSplitAudio({
  ctx, srcLangCode: 'zh', dstLangCode: 'zh',
  sourceFilePath: audioSource,
  srtFilePath: srtPath,
  vocalsFilePath: audioSource,
});

console.log(`Segments: ${resultDir}/segments/vocals/`);
