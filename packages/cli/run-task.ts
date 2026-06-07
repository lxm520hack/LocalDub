import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { Socket } from 'node:net';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { env, REPO_ROOT, WORKFOLDER, YOUTUBE_COOKIE_PATH } from '@repo/config';
import { eq } from 'drizzle-orm';
import { timeId } from '../shared/db/timeId.ts';
import { db } from './src/db/index.ts';
import { readConfig } from './src/feat/config/config.ts';
import type { TargetLang } from './src/feat/config/types.ts';
import { createTask, findTaskByVideoId } from './src/feat/tasks/fn.ts';
import {
	getStageStatuses,
	rerunSingleStage,
	resumePipeline,
	runPipeline,
} from './src/feat/tasks/pipeline-runner.ts';
import { tasks } from './src/feat/tasks/table.ts';
import { extractVideoId, isYouTubeUrl } from './src/feat/tasks/validate.ts';
import { MLDaemon } from './src/ml/daemon/client.ts';
import { DaemonServer } from './src/ml/daemon/server.ts';

function connectToDaemon(port: number): Promise<Socket | null> {
	return new Promise((resolve) => {
		try {
			const conn = connect({ host: '127.0.0.1', port }, () => resolve(conn));
			conn.on('error', () => resolve(null));
		} catch {
			resolve(null);
		}
	});
}

async function runViaTCPSocket(taskId: string, conn: Socket): Promise<void> {
	conn.write(JSON.stringify({ action: 'run_task', task_id: taskId }) + '\n');

	const reader = createInterface({ input: conn });
	for await (const line of reader) {
		let msg: any;
		try {
			msg = JSON.parse(line.trim());
		} catch {
			continue;
		}
		if (msg.type === 'complete' && msg.task_id === taskId) return;
		if (msg.type === 'error' && msg.task_id === taskId)
			throw new Error(msg.message);
	}
}

type Command =
	| 'startTask'
	| 'resumeTask'
	| 'rerunStage'
	| 'checkVideo'
	| 'taskStatus'
	| 'createTask'
	| 'deviceInfo'
	| 'daemon'
	| 'daemonStatus'
	| 'daemonStop'
	| 'listModels';

const config = JSON.parse(readFileSync('./config.json', 'utf-8')) as {
	command?: Command;
	mode?: string;
	startTask?: { taskId?: string };
	createTask?: {
		youtubeUrl?: string;
		bilibiliUrl?: string;
		sourceFile?: string;
		sourceLang?: string;
		targetLang?: TargetLang;
		stages?: Record<string, any>;
	};
	resumeTask?: { taskId?: string; resumeFrom?: string };
	rerunStage?: { taskId?: string; stageName?: string };
	checkVideo?: { taskId?: string };
	taskStatus?: { taskId?: string };
	deviceInfo?: Record<string, never>;
	stages?: Record<string, any>;
	daemonPort?: number;
	daemonIdleTimeout?: number;
};

const cmd: Command = config.command ?? 'startTask';
const DAEMON_PORT = config.daemonPort ?? 19109;

switch (cmd) {
	case 'checkVideo': {
		const taskId = config.checkVideo?.taskId;
		if (!taskId) {
			console.error('checkVideo.taskId required in config.json');
			process.exit(1);
		}
		const rows = await db
			.select({ session_path: tasks.session_path })
			.from(tasks)
			.where(eq(tasks.id, taskId))
			.limit(1);
		const sp = rows[0]?.session_path;
		const basePath = sp ? resolve(REPO_ROOT, sp) : join(WORKFOLDER, taskId);
		const videoPath = join(basePath, 'media', 'video_source.mp4');
		if (!existsSync(videoPath)) {
			console.log(
				JSON.stringify({ ok: false, error: 'video_source.mp4 not found' }),
			);
			process.exit(1);
		}
		const stat = statSync(videoPath);
		console.log(
			JSON.stringify({
				ok: true,
				path: videoPath,
				size: stat.size,
			}),
		);
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
		const engines = readConfig();
		const apiBase =
			engines.translate?.apiBase ||
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
		const url = p.youtubeUrl ?? p.bilibiliUrl;
		if (!url && !p.sourceFile) {
			console.error(
				'createTask: need youtubeUrl, bilibiliUrl, or sourceFile in config.json',
			);
			process.exit(1);
		}
		const videoId = url ? extractVideoId(url) : timeId({ size: 10 });
		try {
			if (url) {
				const existing = await findTaskByVideoId(videoId);
				if (existing) {
					const row = await db
						.select()
						.from(tasks)
						.where(eq(tasks.id, existing))
						.limit(1);
					console.log(
						JSON.stringify(
							{ taskId: existing, url, status: 'exists', task: row[0] },
							null,
							2,
						),
					);
					break;
				}
			}

			const taskMode = config.mode ?? 'dub';
			const [task] = await createTask({
				url,
				taskId: videoId,
				sourceFile: p.sourceFile,
				sourceLang: p.sourceLang,
				targetLang: p.targetLang,
				mode: taskMode,
				stages: config.stages,
			});

			// Fetch video title via yt-dlp --dump-json (optional)
			if (url) {
				try {
					const infoArgs = ['--dump-json'];
					if (isYouTubeUrl(url) && existsSync(YOUTUBE_COOKIE_PATH))
						infoArgs.push('--cookies', YOUTUBE_COOKIE_PATH);
					if (isYouTubeUrl(url) && env.YTDLP_PROXY_PORT)
						infoArgs.push(
							'--proxy',
							`http://127.0.0.1:${env.YTDLP_PROXY_PORT}`,
						);
					infoArgs.push(url);
					const infoR = spawnSync('yt-dlp', infoArgs, {
						stdio: ['pipe', 'pipe', 'pipe'],
						timeout: 30_000,
					});
					if (infoR.status === 0 && infoR.stdout.length > 0) {
						const info = JSON.parse(infoR.stdout.toString());
						if (info.title) {
							await db
								.update(tasks)
								.set({ title: info.title })
								.where(eq(tasks.id, videoId));
							task.title = info.title;
						}
					}
				} catch {
					/* title is optional */
				}
			}

			const displayUrl = url || p.sourceFile || '';
			console.log(
				JSON.stringify(
					{ taskId: videoId, url: displayUrl, status: 'created', task },
					null,
					2,
				),
			);

			console.log(`\n[CLI] Running pipeline for task ${videoId}...`);
			const conn = await connectToDaemon(DAEMON_PORT);
			if (conn) {
				await runViaTCPSocket(videoId, conn);
				conn.end();
			} else {
				const engines = readConfig();
				const needsDaemon =
					engines.tts.runtime === 'pytorch' ||
					engines.separate.runtime === 'pytorch';

				let mlDaemon: MLDaemon | undefined;
				if (needsDaemon) {
					mlDaemon = new MLDaemon();
					await mlDaemon.start();
					console.log('[Daemon] ML pipeline daemon ready');
				}

				try {
					await runPipeline(videoId, mlDaemon);
				} finally {
					if (mlDaemon) await mlDaemon.stop();
				}
			}
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

		// Allow mode switch on resume (e.g. subtitle → dub)
		if (config.mode) {
			const taskRows = await db
				.select({ session_path: tasks.session_path })
				.from(tasks)
				.where(eq(tasks.id, taskId))
				.limit(1);
			if (taskRows.length > 0) {
				const sessionPath = taskRows[0].session_path
					? resolve(REPO_ROOT, taskRows[0].session_path)
					: join(WORKFOLDER, taskId);
				const infoPath = join(sessionPath, 'metadata', 'local_info.json');
				if (existsSync(infoPath)) {
					const localInfo = JSON.parse(readFileSync(infoPath, 'utf-8'));
					localInfo.mode = config.mode;
					writeFileSync(infoPath, JSON.stringify(localInfo, null, 2));
					console.log(`[CLI] Switched mode to "${config.mode}"`);
				}
			}
		}

		console.log(`[CLI] Resuming pipeline for task ${taskId}${label}...`);
		try {
			const conn = await connectToDaemon(DAEMON_PORT);
			if (conn) {
				await runViaTCPSocket(taskId, conn);
				conn.end();
			} else {
				const engines = readConfig();
				const needsDaemon =
					engines.tts.runtime === 'pytorch' ||
					engines.separate.runtime === 'pytorch';

				let mlDaemon: MLDaemon | undefined;
				if (needsDaemon) {
					mlDaemon = new MLDaemon();
					await mlDaemon.start();
					console.log('[Daemon] ML pipeline daemon ready');
				}

				try {
					await resumePipeline(taskId, resumeFrom, config.stages, mlDaemon);
				} finally {
					if (mlDaemon) await mlDaemon.stop();
				}
			}
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
			const engines = readConfig();
			const needsDaemon =
				engines.tts.runtime === 'pytorch' ||
				engines.separate.runtime === 'pytorch';

			let mlDaemon: MLDaemon | undefined;
			if (needsDaemon) {
				mlDaemon = new MLDaemon();
				await mlDaemon.start();
				console.log('[Daemon] ML pipeline daemon ready');
			}

			try {
				await rerunSingleStage(taskId, stageName, config.stages, mlDaemon);
			} finally {
				if (mlDaemon) await mlDaemon.stop();
			}
			console.log('[CLI] Stage completed');
		} catch (err) {
			console.error('[CLI] Stage failed:', err);
			process.exit(1);
		}
		break;
	}

	case 'daemon': {
		process.env.YOUDEUB_DAEMON = '1';

		const engines = readConfig();
		const needsDaemon =
			engines.tts.runtime === 'pytorch' ||
			engines.separate.runtime === 'pytorch';

		let mlDaemon: MLDaemon | undefined;
		if (needsDaemon) {
			mlDaemon = new MLDaemon();
			await mlDaemon.start();
		}

		const daemonPort = config.daemonPort ?? 19109;
		const idleTimeout = config.daemonIdleTimeout ?? 300;
		const server = new DaemonServer(daemonPort, mlDaemon!, idleTimeout);
		await server.start();

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

		const conn = await connectToDaemon(DAEMON_PORT);
		if (conn) {
			await runViaTCPSocket(taskId, conn);
			conn.end();
		} else {
			const engines = readConfig();
			const needsDaemon =
				engines.tts.runtime === 'pytorch' ||
				engines.separate.runtime === 'pytorch';

			let mlDaemon: MLDaemon | undefined;
			if (needsDaemon) {
				mlDaemon = new MLDaemon();
				await mlDaemon.start();
				console.log('[Daemon] ML pipeline daemon ready');
			}

			try {
				await runPipeline(taskId, mlDaemon);
			} catch (err) {
				console.error('[CLI] Pipeline failed:', err);
				process.exit(1);
			} finally {
				if (mlDaemon) await mlDaemon.stop();
			}
		}

		console.log('[CLI] Pipeline completed');
	}
}
