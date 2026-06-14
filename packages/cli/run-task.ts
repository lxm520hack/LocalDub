import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { env, REPO_ROOT, WORKFOLDER, YOUTUBE_COOKIE_PATH } from '@repo/config';
import { eq } from 'drizzle-orm';
import { timeId } from '../shared/db/timeId.ts';
import { db } from './src/db/index.ts';
import {
	pythonBin,
	readConfig,
} from './src/feat/config/config.ts';
import type { RawConfig } from './src/feat/config/types.ts';
import { createTask, findTaskByVideoId } from './src/feat/tasks/fn.ts';
import {
	getStageStatuses,
	rerunSingleStage,
	resumePipeline,
	runPipeline,
} from './src/feat/tasks/pipeline-runner.ts';
import { tasks } from './src/feat/tasks/table.ts';
import { extractVideoId, isYouTubeUrl } from './src/feat/tasks/validate.ts';
import { connectToDaemon, MLDaemon } from './src/ml/daemon/client.ts';
import { cmdCheck } from './src/feat/command/check.ts';
import { setCtx } from './src/feat/context/context.ts';

function needsMLDaemon(cfg: RawConfig): boolean {
	const tts = cfg.stages?.tts;
	const separate = cfg.stages?.separate;
	return tts?.runtime === 'pytorch' || separate?.runtime === 'pytorch';
}

async function withDaemon<T>(
	taskId: string,
	fn: (daemon?: MLDaemon) => Promise<T>,
): Promise<T> {
	const config = readConfig();
	const DAEMON_PORT = config.daemonPort || 19109;

	const conn = await connectToDaemon(DAEMON_PORT);
	if (conn) {
		conn.end();
		const daemon = new MLDaemon(DAEMON_PORT);
		await daemon.start();
		console.log(`[Daemon] Using existing daemon on :${DAEMON_PORT}`);
		return fn(daemon);
	}
	if (needsMLDaemon(config)) {
		const daemon = new MLDaemon(DAEMON_PORT);
		await daemon.start();
		return fn(daemon);
	}
	return fn(undefined);
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
		if (p?.type !== 'font' && !p?.taskId) {
			console.error('check.taskId required for non-font checks');
			process.exit(1);
		}
		await cmdCheck({ type: p?.type, taskId: p?.taskId ?? undefined });
		break;
	}

	case 'taskStatus': {
		const taskId = config.taskStatus?.taskId;
		if (!taskId) {
			console.error('taskStatus.taskId required in config.json');
			process.exit(1);
		}
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

	case 'daemonStatus': {
		const DAEMON_PORT = config.daemonPort || 19109;
		try {
			await new Promise<void>((resolve, reject) => {
				const sock = connect(DAEMON_PORT, '127.0.0.1', () => {
					sock.end();
					resolve();
				});
				sock.on('error', reject);
				sock.setTimeout(2000, () => {
					sock.destroy();
					reject(new Error('timeout'));
				});
			});
			console.log(JSON.stringify({ alive: true, port: DAEMON_PORT }));
		} catch {
			console.log(
				JSON.stringify({
					alive: false,
					port: DAEMON_PORT,
					message: 'Connection failed (daemon not running)',
				}),
			);
		}
		break;
	}

	case 'daemonStop': {
		const DAEMON_PORT = config.daemonPort || 19109;
		try {
			await new Promise<void>((resolve, reject) => {
				const sock = connect(DAEMON_PORT, '127.0.0.1', () => {
					sock.write(JSON.stringify({ action: 'shutdown' }) + '\n');
					resolve();
				});
				sock.on('error', reject);
				sock.setTimeout(2000, () => {
					sock.destroy();
					reject(new Error('timeout'));
				});
			});
			console.log(JSON.stringify({ stopped: true, port: DAEMON_PORT }));
		} catch {
			console.log(
				JSON.stringify({
					stopped: false,
					port: DAEMON_PORT,
					message: 'Connection failed (daemon not running)',
				}),
			);
		}
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
		const appVideoUrl = p.youtubeUrl ?? p.bilibiliUrl;
		if (!appVideoUrl && !p.sourceFile) {
			console.error(
				'createTask: need youtubeUrl, bilibiliUrl, or sourceFile in config.json',
			);
			process.exit(1);
		}
		const videoId = appVideoUrl ? extractVideoId(appVideoUrl) : timeId({ size: 10 });
		try {
			if (appVideoUrl) {
				const existing = await findTaskByVideoId(videoId);
				if (existing) {
					const row = await db
						.select()
						.from(tasks)
						.where(eq(tasks.id, existing))
						.limit(1);
					console.log(
						JSON.stringify(
							{ taskId: existing, appVideoUrl, status: 'exists', task: row[0] },
						),
					);
					break;
				}
			}

			const taskPipeline = config.pipeline;
			const source = p.sourceFile ?  'local' : appVideoUrl ? (isYouTubeUrl(appVideoUrl) ? 'youtube' : 'bilibili') : 'local';
			const url = source === 'local' ? p.sourceFile! : appVideoUrl!;
			const ctx = await createTask({
				source ,
				url,
				taskId: videoId,
				sourceLang: p.sourceLang,
				targetLang: p.targetLang,
				pipeline: taskPipeline,
				stages: config.stages,
			});

			const displayUrl = appVideoUrl || p.sourceFile || '';
			console.log(
				JSON.stringify(
					{ taskId: videoId, url: displayUrl, status: 'created', task: ctx.task },
				),
			);

			console.log(`\n[CLI] Running pipeline for task ${videoId}...`);
			await withDaemon(videoId, (d) => runPipeline(videoId, d));
			console.log('[CLI] Pipeline completed');
		} catch (err) {
			console.error('createTask failed:', err);
			process.exit(1);
		}
		break;
	}

	case 'resumeTask': {
		const taskId = config.resumeTask?.taskId;
		if (!taskId) {
			console.error('resumeTask.taskId required in config.json');
			process.exit(1);
		}
		const resumeFrom = config.resumeTask?.resumeFrom;
		const label = resumeFrom ? ` from "${resumeFrom}"` : '';

		// Allow pipeline switch on resume (e.g. subtitle → dub)
		if (config.pipeline) {
			const taskRows = await db
				.select({ session_path: tasks.session_path })
				.from(tasks)
				.where(eq(tasks.id, taskId))
				.limit(1);
			if (taskRows.length > 0) {
				const sessionPath = taskRows[0].session_path
					? resolve(REPO_ROOT, taskRows[0].session_path)
					: join(WORKFOLDER, taskId);

				setCtx(sessionPath, { pipeline: config.pipeline });
				console.log(`[CLI] Switched pipeline to "${config.pipeline}"`);
			}
		}

		console.log(`[CLI] Resuming pipeline for task ${taskId}${label}...`);
		try {
			await withDaemon(taskId, (d) =>
				resumePipeline(taskId, resumeFrom, config.stages, d),
			);
			console.log('[CLI] Pipeline completed');
		} catch (err) {
			console.error('[CLI] Pipeline failed:', err);
			process.exit(1);
		}
		break;
	}

	case 'rerunStage': {
		const taskId = config.rerunStage?.taskId;
		const stageName = config.rerunStage?.stageName;
		if (!taskId || !stageName) {
			console.error(
				'rerunStage.taskId and rerunStage.stageName required in config.json',
			);
			process.exit(1);
		}
		console.log(`[CLI] Rerunning stage "${stageName}" for task ${taskId}...`);
		try {
			await withDaemon(taskId, (d) =>
				rerunSingleStage(taskId, stageName, config.stages, d),
			);
			console.log('[CLI] Stage completed');
		} catch (err) {
			console.error('[CLI] Stage failed:', err);
			process.exit(1);
		}
		break;
	}

	case 'daemon': {
		const DAEMON_PORT = config.daemonPort || 19109;
		const scriptPath = join(
			REPO_ROOT,
			'packages',
			'cli',
			'scripts',
			'pipeline_daemon.py',
		);
		const voxcpmSrc = join(REPO_ROOT, 'submodule', 'VoxCPM', 'src');

		const pyEnv: Record<string, string> = {
			...(process.env as Record<string, string>),
		};
		const existing = pyEnv.PYTHONPATH || '';
		pyEnv.PYTHONPATH = existing ? `${voxcpmSrc}:${existing}` : voxcpmSrc;

		const proc = spawn(
			pythonBin(),
			[scriptPath, '--port', String(DAEMON_PORT)],
			{
				env: pyEnv,
				detached: true,
				stdio: 'inherit',
			},
		);
		proc.unref();
		console.log(
			`[Daemon] Spawned pipeline daemon (pid ${proc.pid}) on port ${DAEMON_PORT}`,
		);
		process.stdin.resume();
		await new Promise(() => {});
		break;
	}

	case 'startTask':
	default: {
		const taskId = config.startTask?.taskId;
		if (!taskId) {
			console.error('startTask.taskId required in config.json');
			process.exit(1);
		}
		console.log(`[CLI] Starting pipeline for task ${taskId}...`);
		try {
			await withDaemon(taskId, (d) => runPipeline(taskId, d));
			console.log('[CLI] Pipeline completed');
		} catch (err) {
			console.error('[CLI] Pipeline failed:', err);
			process.exit(1);
		}
	}
}
