import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { basename, join, relative } from 'node:path';
import { env, REPO_ROOT, WORKFOLDER, YOUTUBE_COOKIE_PATH } from '@repo/config';
import { sanitizeText } from '../../../tasks/fn.ts';
import { classifySource, extractVideoId, isYouTubeUrl } from '../../../tasks/validate.ts';
import {
	emitLog,
	ffmpeg,
	nowISO,
} from '../../../stages/utils/utils.ts';
import { Context, readCtx, setCtx, setStage, setTask, writeCtx } from '../../../context/context.ts';
import { startLog } from '../../../stages/utils/log.ts';
import { getStages } from '../../../tasks/stages.ts';
import { InputArgs } from '../../../input/input.ts';
import { autoProjectIdAndVideoId, copyFileToPath, downloadRemoteVideo, encodeToMp4 } from './utils.ts';


export const importVideo = async (input: InputArgs) => {
	const args = input.task ?? {};
	const url = args.url
	if (!url) {
		console.error('task start: need task.url in input.json',);
		process.exit(1);
	}
	const {projectId, taskId, info, source}	= await autoProjectIdAndVideoId(url)
	startLog('import', taskId);
	const sessionPath = join(WORKFOLDER, projectId, taskId);
	mkdirSync(sessionPath, { recursive: true });
	const stages = getStages(input.pipeline);
	const ctx: Context = {
		task: {
			id: taskId,
			status: 'queued',
			source: source,
			url,
			created_at: nowISO(),
			session_path: sessionPath,
			title: info.title || taskId,
		},
		asr_language: input.task.sourceLang || 'auto',
		pipeline: input.pipeline || 'dub',
		lastRunPipeline: input.pipeline || 'dub',
		input,
		stages: stages.map((stage) => ({
			task_id: taskId,
			name: stage.name,
			label: stage.label,
			status: 'pending',
		})),
		video_file_path: join(sessionPath, 'video_source.mp4')
	}

	writeCtx(ctx);
	return {ctx, info}
}
export async function downloadVideo(
	ctx: Context,
	info: any
) {
	const videoPath = ctx.video_file_path!
	const url = ctx.task.url
	const sessionPath = ctx.task.session_path
	// Extract audio for downstream stages
	const audioPath = join(sessionPath, 'audio_source.wav');
	if (ctx.task.source === 'local' || ctx.task.source === 'remote') {
		if (ctx.task.source === 'local') {
			copyFileToPath(url, join(sessionPath, basename(url)));
		} else if (ctx.task.source === 'remote') {
			await	downloadRemoteVideo(url, sessionPath);
		}
		
		emitLog(sessionPath, '[Download] Importing local video...');
		await setStage(sessionPath, 'download', {
			last_message: 'Importing local video...',
			progress: 0,
		});

		const t0 = Date.now();
		encodeToMp4(videoPath, videoPath);

		const elapsedSec = (Date.now() - t0) / 1000;

		if (!existsSync(videoPath))
			throw new Error('ffmpeg did not produce video_source.mp4');

		const sizeMb = (statSync(videoPath).size / 1024 / 1024).toFixed(1);
		emitLog(sessionPath, `[Download] Imported in ${elapsedSec.toFixed(1)}s (${sizeMb}MB)`);


		emitLog(sessionPath, '[Download] Extracting audio_source.wav...');
		ffmpeg(['-i', videoPath, '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', audioPath]);

	} else if (ctx.task.source === 'youtube' || ctx.task.source === 'bilibili') {

		try {
			if (info) {
				writeFileSync(
					join(sessionPath, 'download', 'ytdlp_info.json'),
					info,
				);
				await setTask(sessionPath, {
					session_path: relative(REPO_ROOT, sessionPath),
				});
			}
		} catch {
			/* fall back to flat path */
		}

		emitLog(sessionPath, '[Download] Downloading video...');
		await setStage(sessionPath, 'download', {
			last_message: 'Downloading video...',
			progress: 0,
		});

		const ytArgs: string[] = [
			'-f',
			'bestaudio[ext=m4a]+bestvideo[ext=mp4]/best[ext=mp4]/best',
			'--merge-output-format',
			'mp4',
			'-o',
			join(sessionPath, 'video_source.%(ext)s'),
			...info.authArgs,
			url,
		];

		const t0 = Date.now();
		const r = spawnSync('yt-dlp', ytArgs, {
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: 300_000,
		});
		const elapsedSec = (Date.now() - t0) / 1000;

		const dlErr = r.error;
		if (dlErr) throw new Error(`yt-dlp: ${dlErr.message}`);
		if (r.status !== 0)
			throw new Error(
				`yt-dlp exit ${r.status}: ${r.stderr.toString().slice(0, 200)}`,
			);

		if (!existsSync(videoPath))
			throw new Error('yt-dlp did not produce video_source.mp4');

		const sizeMb = (statSync(videoPath).size / 1024 / 1024).toFixed(1);
		emitLog(sessionPath, `[Download] Downloaded in ${elapsedSec.toFixed(1)}s (${sizeMb}MB)`);
		emitLog(sessionPath, `[Download] Speed ${(Number(sizeMb) / elapsedSec).toFixed(2)} MB/s`);

		// Extract audio for downstream stages
		emitLog(sessionPath, '[Download] Extracting audio_source.wav...');
		ffmpeg(['-i', videoPath, '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', audioPath]);
	}

	await setStage(sessionPath, 'download', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
		last_message: 'Imported',
	});
	return;
}
