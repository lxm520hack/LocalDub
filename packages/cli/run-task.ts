import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { env, REPO_ROOT, WORKFOLDER, YOUTUBE_COOKIE_PATH } from '@repo/config';
import { timeId } from '../shared/db/timeId.ts';
import {
	readInputArgs,
} from './src/feat/input/input.ts';
import {

	resumePipeline,
	runPipeline,
} from './src/feat/tasks/pipeline-runner.ts';
import { classifySource, extractVideoId, isYouTubeUrl } from './src/feat/tasks/validate.ts';
import { startTorchServer, stopTorchServer } from './src/ml/server/client.ts';
import { cmdCheck } from './src/feat/command/check.ts';
import { readCtx, readTask, setCtx } from './src/feat/context/context.ts';
import { cmdStartTask } from './src/feat/command/tasks/startTask.ts';
import { cmdServers } from './src/feat/command/servers.ts';
import { cmdResumeTask } from './src/feat/command/tasks/resumeTask.ts';
import { cmdRerunStage } from './src/feat/command/tasks/rerunStage.ts';
import { cmdTaskStatus } from './src/feat/command/tasks/taskStatus.ts';
import { cmdTask } from './src/feat/command/tasks/task.ts';

const input = readInputArgs();
const cmd = input.command;

if (
	input.pipeline === 'subtitle' &&
	input.stages?.separate?.always &&
	!input.stages?.asr?.useSeparated
) {
	console.warn(
		'[WARN] subtitle 模式下 separate.always=true 但 ASR 未使用分离人声 (asr.useSeparated=false)，separate 跑完不会被 ASR 使用',
	);
}

switch (cmd) {
	case 'check': {
		const p = input.check;

		await cmdCheck({ type: p?.type, sessionPath: p?.sessionPath ?? undefined });
		break;
	}



	case 'deviceInfo': {
		const { getDeviceInfo } = await import('@repo/device');
		const info = await getDeviceInfo();
		console.log(JSON.stringify(info, null, 2));
		break;
	}

	case 'listModels': {
		const apiBase =
			input.stages?.translate?.apiBase ||
			env.OPENAI_BASE_URL ||
			'https://api.openai.com/v1';
		const apiKey = env.OPENAI_API_KEY;
		if (!apiKey) {
			console.error('OPENAI_API_KEY not configured');
			process.exit(1);
		}
		try {
			const resp = await fetch(`${apiBase}/models`, {
				headers: { Authorization: `Bearer ${apiKey}` },
			});
			if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
			const data = (await resp.json()) as any;
			for (const m of data.data || []) {
				console.log(`  ${m.id}`);
			}
		} catch (err) {
			console.error('listModels failed:', err);
			process.exit(1);
		}
		break;
	}
	case 'servers': {
		cmdServers(input);
		break;
	}
	case 'task': {
		await cmdTask(input);
		break
	}
	case 'env': {
		const envArgs = input.env ?? { action: 'check', targets: [] };
		const { runCheck, runEnsure, formatResult, listEnv } = await import('@repo/core/cmd/env/index');
		if (envArgs.action === 'list') {
			console.log(listEnv());
			break;
		}
		const results = envArgs.action === 'ensure'
			? await runEnsure(envArgs.targets)
			: await runCheck(envArgs.targets);
		for (const r of results) {
			console.log(formatResult(r));
		}
		break;
	}
	default: {
	}
}
