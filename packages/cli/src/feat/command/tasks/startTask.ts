import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { env, REPO_ROOT, WORKFOLDER, YOUTUBE_COOKIE_PATH } from '@repo/config';
import { DUB_STAGES, getStages } from '../../tasks/stages.ts';
import { Context, VideoSource, writeCtx } from '../../context/context.ts';
import { existsSync } from '../../stages/utils/fileOps.ts';
import { nowISO } from '../../stages/utils/utils.ts';
import { classifySource, isYouTubeUrl } from '../../tasks/validate.ts';
import { InputArgs } from '../../input/input.ts';
import { withTorchServer } from '../utils/utils.ts';
import { runPipeline } from '../../tasks/pipeline-runner.ts';
import { downloadVideo, importVideo } from './import/download.ts';
import { playTaskFail, playTaskSuccess } from './utils.ts';


export const cmdStartTask = async (input: InputArgs) => {
	const args = input.task ?? {};
	const url = args.url
	if (!url) {
		console.error('task start: need task.url in input.json',);
		process.exit(1);
	}
	const {ctx, info} = await importVideo(input);
	await downloadVideo(ctx, info)
	try {
		console.log(`\n[CLI] Running pipeline ...`);
		await runPipeline(ctx)
		console.log('[CLI] Pipeline success');
		playTaskSuccess()
		process.exit(0);
	} catch (err) {
		console.error('cmdCreateTask failed:', err);
		playTaskFail()
		process.exit(1);
	}
}