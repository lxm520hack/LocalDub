import { resolve } from 'node:path';
import { stageMergeVideo } from '../../../cli/src/feat/stages/merge_video';
import type { Context } from '../../../cli/src/feat/context/context';

const label = process.argv[2];
if (!label) { console.error('Usage: bun run-merge-video.ts <results/label>'); process.exit(1); }

const ctxPath = resolve(__dirname, '..', 'results', label, 'metadata', 'ctx.json');
const ctx: Context = JSON.parse(await Bun.file(ctxPath).text());

await stageMergeVideo(ctx);
