import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { env, REPO_ROOT, WORKFOLDER, YOUTUBE_COOKIE_PATH } from '@repo/config';
import { sanitizeText } from './../../feat/tasks/fn.ts';
import { extractVideoId, isYouTubeUrl } from './../../feat/tasks/validate.ts';
import { readLocalInfo, writeLocalInfo } from '../config/config.ts';
import {
	emitLog,
	ffmpeg,
	nowISO,
	updateStageDB,
	updateTaskDB,
} from './utils.ts';

export async function stageDownload(
	taskId: string,
	sessionPath: string,
	url: string,
) {
	let mediaDir = join(sessionPath, 'media');
	let videoPath = join(mediaDir, 'video_source.mp4');

	if (existsSync(videoPath)) {
		await updateStageDB(taskId, 'download', {
			status: 'succeeded',
			completed_at: nowISO(),
			progress: 100,
			last_message: 'Already on disk',
		});
		return;
	}

	// Local upload URL (local://upload/<uploadTaskId>)
	if (url.startsWith('local://')) {
		await updateStageDB(taskId, 'download', {
			last_message: 'Importing local video...',
			progress: 0,
		});
		mkdirSync(mediaDir, { recursive: true });
		mkdirSync(join(sessionPath, 'metadata'), { recursive: true });

		const parsed = new URL(url);
		// 从路径解析出 taskId
		const uploadTaskId = parsed.pathname.replace(/^\/+/, '').split('/')[0];

		const uploadDir = join(WORKFOLDER, '_uploads', uploadTaskId);
		const files = readdirSync(uploadDir).filter((f) => f !== '.' && f !== '..');
		if (files.length === 0)
			throw new Error(`Upload directory empty: ${uploadDir}`);
		const sourceFile = join(uploadDir, files[0]);

		ffmpeg([
			'-i',
			sourceFile,
			'-map',
			'0:v:0',
			'-map',
			'0:a:0?',
			'-c:v',
			'libx264',
			'-preset',
			'fast',
			'-crf',
			'23',
			'-c:a',
			'aac',
			'-movflags',
			'+faststart',
			videoPath,
		]);

		if (!existsSync(videoPath))
			throw new Error('ffmpeg did not produce video_source.mp4');

		// Preserve existing fields  from fn.ts
		const existing = readLocalInfo(sessionPath);
		writeLocalInfo(sessionPath, {
			...existing,
			id: uploadTaskId,
			title: files[0].replace(/\.\w+$/, ''),
			source: 'local',
			webpage_url: url,
			original_path: sourceFile,
			asr_language: 'auto',
			pipeline: existing?.pipeline || 'dub',
		});

		await updateStageDB(taskId, 'download', {
			status: 'succeeded',
			completed_at: nowISO(),
			progress: 100,
			last_message: 'Imported',
		});
		return;
	}

	// YouTube/Bilibili URL — download via yt-dlp
	let isDownloadable = false;
	try {
		isDownloadable = !!extractVideoId(url);
	} catch {
		/* not a yt/bili url */
	}
	if (!isDownloadable) {
		throw new Error(
			`Cannot download: unsupported URL "${url}". Use a YouTube/Bilibili URL or upload a local file.`,
		);
	}

	const isYT = isYouTubeUrl(url);
	const authArgs: string[] = [];
	if (isYT && existsSync(YOUTUBE_COOKIE_PATH))
		authArgs.push('--cookies', YOUTUBE_COOKIE_PATH);
	if (isYT && env.YTDLP_PROXY_PORT)
		authArgs.push('--proxy', `http://127.0.0.1:${env.YTDLP_PROXY_PORT}`);

	let resolvedSession = sessionPath;
	try {
		const infoArgs = ['--dump-json', ...authArgs, url];
		const infoR = spawnSync('yt-dlp', infoArgs, {
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: 30_000,
		});
		if (infoR.status === 0 && infoR.stdout.length > 0) {
			const info = JSON.parse(infoR.stdout.toString());
			const uploader = sanitizeText(info.uploader || '', 'unknown');
			const title = sanitizeText(info.title || '', 'untitled');
			const videoId = info.id || extractVideoId(url);
			resolvedSession = join(WORKFOLDER, uploader, `${title}__${videoId}`);

			mkdirSync(join(resolvedSession, 'metadata'), { recursive: true });
			writeFileSync(
				join(resolvedSession, 'metadata', 'ytdlp_info.json'),
				infoR.stdout,
			);

			await updateTaskDB(taskId, {
				session_path: relative(REPO_ROOT, resolvedSession),
			});
		}
	} catch {
		/* fall back to flat path */
	}

	mediaDir = join(resolvedSession, 'media');
	videoPath = join(mediaDir, 'video_source.mp4');

	await updateStageDB(taskId, 'download', {
		last_message: 'Downloading video...',
		progress: 0,
	});
	mkdirSync(mediaDir, { recursive: true });
	mkdirSync(join(resolvedSession, 'metadata'), { recursive: true });

	const ytArgs: string[] = [
		'-f',
		'bestaudio[ext=m4a]+bestvideo[ext=mp4]/best[ext=mp4]/best',
		'--merge-output-format',
		'mp4',
		'-o',
		join(mediaDir, 'video_source.%(ext)s'),
		...authArgs,
		url,
	];

	const r = spawnSync('yt-dlp', ytArgs, {
		stdio: ['pipe', 'pipe', 'pipe'],
		timeout: 300_000,
	});

	const dlErr = r.error;
	if (dlErr) throw new Error(`yt-dlp: ${dlErr.message}`);
	if (r.status !== 0)
		throw new Error(
			`yt-dlp exit ${r.status}: ${r.stderr.toString().slice(0, 200)}`,
		);

	if (!existsSync(videoPath))
		throw new Error('yt-dlp did not produce video_source.mp4');

	await updateStageDB(taskId, 'download', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
		last_message: 'Downloaded',
	});
}
