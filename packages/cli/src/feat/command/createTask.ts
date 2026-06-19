import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { env, REPO_ROOT, WORKFOLDER, YOUTUBE_COOKIE_PATH } from '@repo/config';
import { DUB_STAGES, getStages } from './../../feat/tasks/stages.ts';
import type { Ctx, TargetLang } from '../config/types.ts';
import { Context, VideoSource, writeCtx } from '../context/context.ts';
import { existsSync } from '../stages/utils/fileOps.ts';
import { nowISO } from '../stages/utils/utils.ts';
import { isYouTubeUrl } from '../tasks/validate.ts';


function parseDirAndId(filePath: string): { dir: string; id: string } {
	const parts = filePath.split(/[/\\]/).filter(Boolean);
	if (parts.length === 0) return { dir: 'default', id: 'video' };
	const fileName = parts.pop() || 'video';
	const id = fileName.replace(/\.[^.]+$/, '');
	const parentDir = parts.pop() || 'default';
	const genericDirs = new Set([
		'videos', 'video', 'downloads', 'download', 'media',
		'tmp', 'temp', 'uploads', 'upload', 'files', 'workfolder', 'local'
	]);
	if (genericDirs.has(parentDir.toLowerCase()) && parts.length > 0) {
		const grandParentDir = parts.pop();
		if (grandParentDir && !genericDirs.has(grandParentDir.toLowerCase())) {
			return { dir: grandParentDir, id };
		}
	}
	return { dir: parentDir || 'root', id };
}

export async function createTask({
	pipeline = 'dub',
	url,
	source,
	...params
}: {
	url: string;
	taskId?: string;
	source: VideoSource
	sourceLang?: string;
	targetLang?: TargetLang;
	pipeline?: 'dub' | 'subtitle';
	stages?: Record<string, Record<string, unknown>>;
}) {
	const createdAt = nowISO();
	const stages = getStages(pipeline);
	const { dir: parsedDir, id: parsedId } = parseDirAndId(url);
	const taskId = params.taskId || parsedId;

	let ctx: Context = {
		task: {
			id: taskId,
			status: 'queued',
			source,
			url: url,
			created_at: createdAt,
			current_stage: stages[0].name,
			session_path: '',
		},
		asr_language: params.sourceLang || 'auto',
		pipeline,
		lastRunPipeline: pipeline,
		stages: stages.map((stage) => ({
			task_id: taskId,
			name: stage.name,
			label: stage.label,
			status: 'pending',
		}))
	}
	if (source === 'local' || source === 'remote') {
		const sessionPath = join(WORKFOLDER, 'local', parsedDir, taskId);
		mkdirSync(sessionPath, { recursive: true });

		let filename: string;
		if (
			url.startsWith('http://') ||
			url.startsWith('https://')
		) {
			const urlO = new URL(url);
			filename = basename(urlO.pathname) || 'video.mp4';
			const resp = await fetch(url);
			if (!resp.ok)
				throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
			const buf = Buffer.from(await resp.arrayBuffer());
			writeFileSync(join(sessionPath, filename), buf);
		} else {
			filename = basename(url);
			copyFileSync(url, join(sessionPath, filename));
		}

		mkdirSync(join(sessionPath, 'metadata'), { recursive: true });
		ctx.task.title = filename.replace(/\.\w+$/, '')
		ctx.task.session_path = sessionPath
	} else if (source === 'youtube' || source === 'bilibili') {
		// Fetch video title via yt-dlp --dump-json (optional)
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
			const { spawnSync } = await import('node:child_process');
			const infoR = spawnSync('yt-dlp', infoArgs, {
				stdio: ['pipe', 'pipe', 'pipe'],
				timeout: 30_000,
			});
			if (infoR.status === 0 && infoR.stdout.length > 0) {
				const info = JSON.parse(infoR.stdout.toString());
				if (info.title) {
					ctx.task.title = info.title;
				}
			}
		} catch {
			/* title is optional */
		}
	}
	writeCtx(ctx);
	return ctx;
}
