import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { env, WORKFOLDER, YOUTUBE_COOKIE_PATH } from '@repo/config';
import { DUB_STAGES, getStages } from './../../feat/tasks/stages.ts';
import type {  TargetLang } from '../config/types.ts';
import { Context, writeCtx } from '../context/context.ts';
import { isYouTubeUrl } from './validate.ts';
import { existsSync } from '../stages/utils/fileOps.ts';

export function sanitizeText(value: string, fallback = 'untitled'): string {
	const cleaned = value
		.replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^[._]+|[._]+$/g, '');
	return cleaned.slice(0, 120) || fallback;
}

export function nowISO(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, '');
}

// export async function findTaskByVideoId(
// 	videoId: string,
// ): Promise<string | null> {
// 	const rows = await db
// 		.select({ id: tasks.id })
// 		.from(tasks)
// 		.where(sql`${tasks.id} = ${videoId} OR ${tasks.url} LIKE ${`%${videoId}%`}`)
// 		.orderBy(sql`created_at DESC, rowid DESC`)
// 		.limit(1);
// 	return rows[0]?.id ?? null;
// }

export async function createTask({
	pipeline = 'dub',
	url,
	source,
	...params}: {
		url: string;
	taskId: string;
	source: 'youtube' | 'bilibili' | 'local';
	sourceLang?: string;
	targetLang?: TargetLang;
	pipeline?: 'dub' | 'subtitle';
	stages?: Record<string, Record<string, unknown>>;
}) {
	const createdAt = nowISO();
	const stages = getStages(pipeline);
	let ctx: Context = {
		task: {
				id: params.taskId,
				status: 'queued',
				source,
				url: url,
				created_at: createdAt,
				current_stage: stages[0].name,
				session_path: 'unset',
			},
			asr_language: params.sourceLang || 'auto',
			pipeline,
			lastRunPipeline: pipeline,
			stages: stages.map((stage) => ({
				task_id: params.taskId,
				name: stage.name,
				label: stage.label,
				status: 'pending',
			}))
	}
	if (source==='local') {
		const uploadDir = join(WORKFOLDER, '_uploads', params.taskId);
		mkdirSync(uploadDir, { recursive: true });

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
			writeFileSync(join(uploadDir, filename), buf);
		} else {
			filename = basename(url);
			copyFileSync(url, join(uploadDir, filename));
		}

		const sessionPath = join(WORKFOLDER, 'local', params.taskId);
		mkdirSync(join(sessionPath, 'metadata'), { recursive: true });
		ctx.task.title = filename.replace(/\.\w+$/, '')
		ctx.task.session_path =`workfolder/local/${params.taskId}`

		
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

	// const { ret } = await db.transaction(async (tx) => {
	// 	const ret = await tx
	// 		.insert(tasks)
	// 		.values({
	// 			id: params.taskId,
	// 			url: taskUrl,
	// 			status: 'queued',
	// 			current_stage: stages[0].name,
	// 			created_at: createdAt,
	// 		})
	// 		.returning();

	// 	await tx.insert(taskStages).values(
	// 		stages.map((stage) => ({
	// 			task_id: params.taskId,
	// 			name: stage.name,
	// 			label: stage.label,
	// 			status: 'pending',
	// 		})),
	// 	);

	// 	return { ret };
	// });

	// if (url) {
	// 	await db
	// 		.update(tasks)
	// 		.set({ session_path: `workfolder/local/${params.taskId}` })
	// 		.where(eq(tasks.id, params.taskId));
	// }
	writeCtx(ctx);
	return ctx;
}

// const STAGE_ORDER_CASE = sql`CASE ${DUB_STAGES.map(
// 	(s, i) => sql`WHEN ${taskStages.name} = ${s.name} THEN ${i + 1}`,
// )} ELSE 99 END`;

// export async function updateTask(
// 	taskId: string,
// 	fields: Record<string, unknown>,
// ) {
// 	if (Object.keys(fields).length === 0) return;
// 	await db.update(tasks).set(fields).where(eq(tasks.id, taskId));
// }

// export async function updateStage(
// 	taskId: string,
// 	name: string,
// 	fields: Record<string, unknown>,
// ) {
// 	if (Object.keys(fields).length === 0) return;
// 	await db
// 		.update(taskStages)
// 		.set(fields)
// 		.where(
// 			sql`${taskStages.task_id} = ${taskId} AND ${taskStages.name} = ${name}`,
// 		);
// }

// export async function deleteTask(taskId: string) {
// 	await db.delete(tasks).where(eq(tasks.id, taskId));
// }
