import { readJson, writeFile, ensureDir, fileLog } from '@repo/core/utils/fileOps';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Context, readCtx, setStage, setTask, } from '@repo/core/context/context.ts';
import { alignmentToFfmpeg } from '@repo/core/input/types';
import {
	ffmpeg,
	nowISO,
	probeVideoResolution,
	readTaskLanguages,
	subtitleFilePath,
	finalVideoFilename,
	translationFilePath,
	bgmPath,
	defaultFont,
	video_source_path,
    timings_filepath,
    split_audio_timings_filepath,
} from '@repo/core/stages/utils/utils';
import { startLog } from './utils/log.ts';
import { writeSrt } from '@repo/core/utils/srt';

function filterSubPath(subPath: string): string {
	if (process.platform !== 'win32') return subPath;
	return subPath.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function dstLangFromTranslation(translation: any[]): string {
	return translation.find((t: any) => t.dst_lang)?.dst_lang || 'zh';
}

function probeStyle(
	videoFile: string,
	dstLang: string,
	overrides?: {
		fontSize?: number;
		font?: string;
		marginV?: number;
		alignment?: number;
		outline?: number;
		shadow?: number;
	},
): string {
	const { width, height } = probeVideoResolution(videoFile);
	const isPortrait = height > width;
	const fontSize =
		overrides?.fontSize ??
		(isPortrait ? (dstLang === 'zh' ? 12 : 9) : dstLang === 'zh' ? 24 : 18);
	const marginV = overrides?.marginV ?? (isPortrait ? 70 : 5);
	const alignment = overrides?.alignment ?? 2;
	const outline = overrides?.outline ?? 0;
	const shadow = overrides?.shadow ?? 1;
	const font = overrides?.font ?? defaultFont(dstLang);
	return `FontName=${font},FontSize=${fontSize},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=${outline > 0 ? 1 : 0},Outline=${outline},Shadow=${shadow},Alignment=${alignment},MarginV=${marginV}`;
}

export async function stageMergeVideo(ctx: Context) {
	startLog('merge_video', ctx.task.id);
	const taskId = ctx.task.id;
	const taskDir = ctx.task.task_dir;
	const video_file_path = video_source_path(ctx)
	const mergeVideoDir = join(taskDir, 'merge_video');
	ensureDir(mergeVideoDir, ctx);
	const tmpDir = join(taskDir, 'tmp');
	const srtPath = ctx.input?.stages?.merge_video?.srtPath
	const subtitleSource = ctx.input?.task?.subtitleSource;
	if (!existsSync(video_file_path)) throw new Error('video_source.mp4 not found');

	const pipeline = readCtx(taskDir)?.pipeline || 'dub';

	const mergeCfg = ctx.input?.stages?.merge_video;
	const probeOverrides = {
		fontSize: mergeCfg?.fontSize ?? undefined,
		font: mergeCfg?.font ?? undefined,
		marginV: mergeCfg?.marginV ?? undefined,
		alignment: alignmentToFfmpeg(mergeCfg?.alignment ?? 'bottom-center'),
		outline: mergeCfg?.outline ?? undefined,
		shadow: mergeCfg?.shadow ?? undefined,
	};

	const noTranslate = ctx.input?.stages?.translate?.enabled === false;
	const finalVideo = join(
		mergeVideoDir,
		finalVideoFilename(taskId, pipeline, ctx.input?.task?.subtitleSource ?? 'asr', noTranslate),
	);

	if (pipeline === 'subtitle') {
		const vadAlign = ctx.input?.stages?.split_audio?.vadAlign;
		const translateEnabled = ctx.input?.stages?.translate?.enabled ?? true;
		let data: { translation: any[] };
		if (vadAlign) {
			data = await readJson(split_audio_timings_filepath(taskDir), ctx);
		} else if (translateEnabled) {
			const { targetLanguage: dstLangCode } = readTaskLanguages(ctx);
			const trFile = translationFilePath(taskDir, dstLangCode);
			data = await readJson(trFile, ctx);
		} else {
			const srt = await readJson(srtPath ? srtPath : subtitleFilePath(ctx), ctx);
			const segments = srt.result?.segments ?? [];
			data = {
				translation: segments.map((seg: any) => ({
					src: seg.text,
					dst: seg.text,
				start_time: Math.round(seg.start),
				end_time: Math.round(seg.end),
					speaker: '1',
				})),
			};
		}
		const dstLang = dstLangFromTranslation(data.translation);
		const subPath = join(mergeVideoDir, `subtitles.${dstLang}.srt`);
		writeSrt(data.translation, ctx, subPath, !translateEnabled);
		const style = probeStyle(video_file_path, dstLang, probeOverrides);

		ffmpeg(
			[
				'-i',
				video_file_path,
				'-vf',
				`subtitles='${filterSubPath(subPath)}':force_style='${style}'`,
				'-map',
				'0:v:0',
				'-map',
				'0:a:0',
				'-c:v',
				'libx264',
				'-preset',
				'fast',
				'-crf',
				'23',
				'-c:a',
				'copy',
				'-movflags',
				'+faststart',
				finalVideo,
			],
			300_000,
		);
	} else {
		const dubbingFile = join(taskDir, 'merge_audio', 'audio_dubbing.wav');
		const ctxBgmPath = ctx.input?.stages?.merge_video?.bgmPath;
		const bgmFile = ctxBgmPath ? ctxBgmPath : bgmPath(taskDir);
		const timingsFile = timings_filepath(taskDir);

		if (!existsSync(dubbingFile))
			throw new Error('audio_dubbing.wav not found');
		if (!existsSync(timingsFile)) throw new Error('timings.json not found');

		const data = await readJson(timingsFile, ctx);
		const dstLang = dstLangFromTranslation(data.translation);
		const subPath = join(mergeVideoDir, `subtitles.${dstLang}.srt`);
		writeSrt(data.translation, ctx, subPath);
		const style = probeStyle(video_file_path, dstLang, probeOverrides);

		const bgmGain = ctx.input?.stages?.merge_video?.bgmGain ?? -6;
		const dubGain = ctx.input?.stages?.merge_video?.dubGain ?? 3;
		const mixedAudio = join(mergeVideoDir, 'audio_mixed.m4a');
		ffmpeg([
			'-i',
			dubbingFile,
			'-i',
			bgmFile,
			'-filter_complex',
			`[0:a]volume=${dubGain}dB[adub];[1:a]volume=${bgmGain}dB[abgm];[adub]asplit[adub_mix][adub_key];[abgm][adub_key]sidechaincompress=threshold=-24dB:ratio=4:attack=5:release=300[abgm_sc];[adub_mix][abgm_sc]amix=inputs=2:duration=longest:normalize=0,acompressor=threshold=-24dB:ratio=2,alimiter=limit=-1dB[aout]`,
			'-map',
			'[aout]',
			'-c:a',
			'aac',
			mixedAudio,
		]);

		ffmpeg(
			[
				'-i',
				video_file_path,
				'-i',
				mixedAudio,
				'-vf',
				`subtitles='${filterSubPath(subPath)}':force_style='${style}'`,
				'-map',
				'0:v:0',
				'-map',
				'1:a:0',
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
				'-shortest',
				finalVideo,
			],
			300_000,
		);
	}

	fileLog(ctx, 'write', finalVideo);

	await setStage(taskDir, 'merge_video', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
		last_message: 'Merged',
	});

	const finalPath = `/api/video/${taskId}`;
	await setTask(taskDir, { final_video_path: finalPath });
}
