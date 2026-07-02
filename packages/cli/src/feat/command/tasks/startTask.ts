import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DUB_STAGES, getStages } from '@repo/core/stages/utils/stages';
import { existsSync } from '@repo/core/utils/fileOps';
import { classifySource, isYouTubeUrl } from '../../tasks/validate.ts';
import { InputArgs } from '@repo/core/input/input';
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