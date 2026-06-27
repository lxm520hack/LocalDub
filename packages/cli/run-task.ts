import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { env, REPO_ROOT, WORKFOLDER, YOUTUBE_COOKIE_PATH } from '@repo/config';
import { timeId } from '../shared/db/timeId.ts';
import {
	pythonBin,
	readConfig,
} from './src/feat/config/config.ts';
import type { RawInput } from './src/feat/config/types.ts';
import {
	getStageStatuses,
	rerunSingleStage,
	resumePipeline,
	runPipeline,
} from './src/feat/tasks/pipeline-runner.ts';
import { classifySource, extractVideoId, isYouTubeUrl } from './src/feat/tasks/validate.ts';
import { startTorchServer, stopTorchServer } from './src/ml/server/client.ts';
import { cmdCheck } from './src/feat/command/check.ts';
import { readCtx, readTask, setCtx } from './src/feat/context/context.ts';
import { createTask } from './src/feat/command/createTask.ts';
import { cmdServers } from './src/feat/command/servers.ts';

async function withTorchServer<T>(
	taskId: string,
	fn: (torchServer: string) => Promise<T>,
): Promise<T> {
	const config = readConfig();
	const TORCH_SERVER_PORT = config.torchServer?.port ?? 19109;
	const baseUrl = await startTorchServer(TORCH_SERVER_PORT);
	return await fn(baseUrl);
}

const config = readConfig();
const cmd = config.command;

if (
	config.pipeline === 'subtitle' &&
	config.stages?.separate?.always &&
	!config.stages?.asr?.useSeparated
) {
	console.warn(
		'[WARN] subtitle 模式下 separate.always=true 但 ASR 未使用分离人声 (asr.useSeparated=false)，separate 跑完不会被 ASR 使用',
	);
}

switch (cmd) {
	case 'check': {
		const p = config.check;

		await cmdCheck({ type: p?.type, sessionPath: p?.sessionPath ?? undefined });
		break;
	}

	case 'taskStatus': {
		const sessionPath = config.taskStatus?.sessionPath!;

		const ctx = await readCtx(sessionPath);
		const taskId = ctx.task.id;
		try {
			const status = await getStageStatuses(taskId);
			console.log(JSON.stringify(status, null, 2));
		} catch (err) {
			console.error('taskStatus failed:', err);
			process.exit(1);
		}
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
			config.stages?.translate?.apiBase ||
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

	case 'createTask': {
		const p = config.createTask ?? {};
		const url = p.url
		if (!url) {
			console.error(
				'createTask: need createTask.url in input.json',
			);
			process.exit(1);
		}
		try {
			const taskPipeline = config.pipeline;
			const source = await classifySource(url)
			const ctx = await createTask({
				source,
				url,
				sourceLang: p.sourceLang,
				targetLang: p.targetLang,
				pipeline: taskPipeline,
				stages: config.stages,
			});

			const taskId = ctx.task.id;
			console.log(
				JSON.stringify(
					{ taskId, sessionPath: ctx.task.session_path, url, status: 'created', task: ctx.task },
				),
			);

			console.log(`\n[CLI] Running pipeline for task ${taskId} (${ctx.task.session_path})...`);
			await withTorchServer(taskId, () => runPipeline(ctx));
			console.log('[CLI] Pipeline success');
			process.exit(0);
		} catch (err) {
			console.error('createTask failed:', err);
			process.exit(1);
		}
		break;
	}

	case 'resumeTask': {
		const sessionPath = config.resumeTask?.sessionPath;
		if (!sessionPath) {
			console.error('resumeTask.sessionPath required in input.json');
			process.exit(1);
		}
		const ctx = await readCtx(sessionPath);
		const taskId = ctx.task.id;
		const resumeFrom = config.resumeTask?.resumeFrom;
		const label = resumeFrom ? ` from "${resumeFrom}"` : '';

		// Allow pipeline switch on resume (e.g. subtitle → dub)
		if (config.pipeline) {
				setCtx(sessionPath, { pipeline: config.pipeline });
		}

		console.log(`[CLI] Resuming pipeline for task ${sessionPath}${label}...`);
		try {
			await withTorchServer(taskId, () =>
				resumePipeline(ctx, resumeFrom, config.stages),
			);
			console.log('[CLI] Pipeline completed');
			process.exit(0);
		} catch (err) {
			console.error('[CLI] Pipeline failed:', err);
			process.exit(1);
		}
		break;
	}

	case 'rerunStage': {
		const sessionPath = config.rerunStage?.sessionPath;
		const stageName = config.rerunStage?.stageName;
		if (!sessionPath || !stageName) {
			console.error(
				'rerunStage.sessionPath and rerunStage.stageName required in input.json',
			);
			process.exit(1);
		}
		const ctx = await readCtx(sessionPath);
		const taskId = ctx.task.id;
		console.log(`[CLI] Rerunning stage "${stageName}" for task ${taskId}...`);
		try {
			await withTorchServer(taskId, () =>
				rerunSingleStage(ctx, stageName, config.stages),
			);
			console.log('[CLI] Stage completed');
			process.exit(0);
		} catch (err) {
			console.error('[CLI] Stage failed:', err);
			process.exit(1);
		}
		break;
	}

	case 'servers': {
		cmdServers(config);
		break;
	}

	case 'startTask':
	default: {
		const sessionPath = config.startTask?.sessionPath;
		if (!sessionPath) {
			console.error('startTask.sessionPath required in input.json');
			process.exit(1);
		}
				const ctx = await readCtx(sessionPath);
		const taskId = ctx.task.id;
		console.log(`[CLI] Starting pipeline for task ${taskId}...`);
		try {
			await withTorchServer(taskId, () => runPipeline(ctx));
			console.log('[CLI] Pipeline completed');
			process.exit(0);
		} catch (err) {
			console.error('[CLI] Pipeline failed:', err);
			process.exit(1);
		}
	}
}
