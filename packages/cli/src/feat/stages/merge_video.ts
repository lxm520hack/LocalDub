import { spawnSync } from 'node:child_process';
import { readJson, writeFile, ensureDir, fileLog } from './utils/fileOps.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Context, readCtx, setStage, setTask, } from '../context/context.ts';
import { alignmentToFfmpeg } from '../config/types.ts';
import {
	ffmpeg,
	nowISO,
	readTaskLanguages,
	srtTime,
	subtitleFilePath,
	finalVideoFilename,
	translationFilePath,
} from './utils/utils.ts';

function writeSrt(translation: any[], ctx: Context, outputPath: string, useSource?: boolean) {
	const CLOSING_QUOTES = new Set([
		'"',
		"'",
		'」',
		'』',
		'》',
		'）',
		'】',
		'\u201d',
		'\u2019',
		']',
	]);
	const PUNCTUATION = new Set([
		'，',
		',',
		'；',
		';',
		'：',
		':',
		'。',
		'?',
		'？',
		'!',
		'！',
		'、',
	]);
	const PROTECTED_PAIRS: Record<string, string> = {
		'《': '》',
		'（': '）',
		'【': '】',
		'「': '」',
		'『': '』',
	};

	function splitProtected(text: string): string[] {
		const segs: string[] = [];
		let buf: string[] = [],
			inside: string | null = null;
		for (const ch of text) {
			if (!inside && ch in PROTECTED_PAIRS) {
				inside = PROTECTED_PAIRS[ch];
				buf.push(ch);
				continue;
			}
			if (inside && ch === inside) {
				inside = null;
				buf.push(ch);
				continue;
			}
			if (!inside && PUNCTUATION.has(ch)) {
				const s = buf.join('').trim();
				if (s) segs.push(s);
				buf = [];
				continue;
			}
			buf.push(ch);
		}
		const tail = buf.join('').trim();
		if (tail) segs.push(tail);
		return segs;
	}

	function attachClosingQuotes(segs: string[]): string[] {
		const fixed: string[] = [];
		for (const s of segs) {
			if (s && CLOSING_QUOTES.has(s[0]) && fixed.length) {
				fixed[fixed.length - 1] = `${fixed[fixed.length - 1]}${s}`.trim();
			} else {
				fixed.push(s.trim());
			}
		}
		return fixed;
	}

	function mergeShort(segs: string[]): string[] {
		const merged: string[] = [];
		let i = 0;
		while (i < segs.length) {
			const cur = segs[i];
			if (cur.trim().length < 5 && i + 1 < segs.length) {
				segs[i + 1] = `${cur}${segs[i + 1]}`.trim();
				i++;
				continue;
			}
			merged.push(cur);
			i++;
		}
		return merged;
	}

	function stripTrailingPunct(segs: string[]): string[] {
		return segs
			.map((s) => {
				const t = s.trim();
				if (!t) return '';
				if (t.endsWith('，') || t.endsWith(',') || t.endsWith('。'))
					return t.slice(0, -1);
				return t.replace(/\s+/g, ' ').trim();
			})
			.filter(Boolean);
	}

	function splitSubtitle(text: string): string[] {
		if (!text.trim()) return [];
		const segs = stripTrailingPunct(
			mergeShort(attachClosingQuotes(splitProtected(text))),
		);
		return segs.length ? segs : [text.trim()];
	}

	const lines: string[] = [];
	let idx = 1;
	for (const item of translation) {
		const start = Math.floor(item.actual_start_time ?? item.start_time);
		const end = Math.floor(item.actual_end_time ?? item.end_time);
		if (end <= start) continue;

		const text = (
			useSource ? (item.src || '').trim() : (item.dst || item.zh || '').trim()
		);
		if (!text) continue;
		const fragments = ctx.input?.subtitleSource === 'ocr' || ctx.input?.subtitleSource === 'asr_ocr'
			? [text]
			: splitSubtitle(text);
		if (!fragments.length) continue;

		const totalDuration = end - start;
		const weights = fragments.map((f) =>
			Math.max(1, f.replace(/\s/g, '').length),
		);
		const totalWeight = weights.reduce((a, b) => a + b, 0);
		let cursor = start,
			allocated = 0;

		for (let f = 0; f < fragments.length; f++) {
			const share =
				f < fragments.length - 1
					? Math.max(
							200,
							Math.min(
								Math.round((totalDuration * weights[f]) / totalWeight),
								totalDuration - allocated - 100,
							),
						)
					: Math.max(100, totalDuration - allocated);
			lines.push(String(idx));
			lines.push(`${srtTime(cursor)} --> ${srtTime(cursor + share)}`);
			lines.push(fragments[f]);
			lines.push('');
			cursor += share;
			allocated += share;
			idx++;
		}
	}

	writeFile(outputPath, lines.join('\n'), ctx);
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
	const probe = spawnSync(
		'ffprobe',
		[
			'-v',
			'error',
			'-select_streams',
			'v:0',
			'-show_entries',
			'stream=width,height',
			'-of',
			'csv=p=0',
			videoFile,
		],
		{ stdio: ['pipe', 'pipe', 'pipe'] },
	);
	const sizeStr = probe.stdout.toString().trim();
	const [wStr, hStr] = sizeStr.split(',');
	const width = parseInt(wStr),
		height = parseInt(hStr);
	const isPortrait = height > width;
	const fontSize =
		overrides?.fontSize ??
		(isPortrait ? (dstLang === 'zh' ? 12 : 9) : dstLang === 'zh' ? 24 : 18);
	const marginV = overrides?.marginV ?? (isPortrait ? 70 : 5);
	const alignment = overrides?.alignment ?? 2;
	const outline = overrides?.outline ?? 0;
	const shadow = overrides?.shadow ?? 1;
	const font = overrides?.font ?? (dstLang === 'zh' ? 'Noto Sans CJK SC' : 'Arial');
	return `FontName=${font},FontSize=${fontSize},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=${outline > 0 ? 1 : 0},Outline=${outline},Shadow=${shadow},Alignment=${alignment},MarginV=${marginV}`;
}

export async function stageMergeVideo(ctx: Context) {
	const taskId = ctx.task.id;
	const sessionPath = ctx.task.session_path;
	const video_file_path = ctx.video_file_path ?? join(sessionPath, 'media', 'video_source.mp4')
	await setTask(sessionPath, { current_stage: 'merge_video' });
	const mediaDir = join(sessionPath, 'media');
	ensureDir(mediaDir, ctx);
	const tmpDir = join(sessionPath, 'tmp');
	const metadataDir = join(sessionPath, 'metadata');
	const srtPath = ctx.input?.stages?.merge_video?.srtPath
	const subtitleSource = ctx.input?.subtitleSource;
	if (!existsSync(video_file_path)) throw new Error('video_source.mp4 not found');

	const pipeline = readCtx(sessionPath)?.pipeline || 'dub';

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
		mediaDir,
		finalVideoFilename(taskId, pipeline, ctx.input?.subtitleSource ?? 'asr', noTranslate),
	);

	if (pipeline === 'subtitle') {
		const vadAlign = ctx.input?.stages?.split_audio?.vadAlign;
		const translateEnabled = ctx.input?.stages?.translate?.enabled ?? true;
		let data: { translation: any[] };
		if (vadAlign) {
			data = await readJson(join(metadataDir, 'timings.json'), ctx);
		} else if (translateEnabled) {
			const { targetLanguage: dstLangCode } = readTaskLanguages(ctx);
			const trFile = translationFilePath(sessionPath, dstLangCode);
			data = await readJson(trFile, ctx);
		} else {
			const srt = await readJson(srtPath ? srtPath : subtitleFilePath(sessionPath, subtitleSource), ctx);
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
		const subPath = join(metadataDir, `subtitles.${dstLang}.srt`);
		writeSrt(data.translation, ctx, subPath, !translateEnabled);
		const style = probeStyle(video_file_path, dstLang, probeOverrides);
		const escapedSub = subPath.replace(/'/g, "'\\\\''").replace(/'/g, "'\\''");

		ffmpeg(
			[
				'-i',
				video_file_path,
				'-vf',
				`subtitles='${escapedSub}':force_style='${style}'`,
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
		const dubbingFile = join(tmpDir, 'audio_dubbing.wav');
		const ctxBgmPath = ctx.input?.stages?.merge_video?.bgmPath;
		const bgmFile = ctxBgmPath ? ctxBgmPath : join(mediaDir, 'target_bgm.wav');
		const timingsFile = join(metadataDir, 'timings.json');

		if (!existsSync(dubbingFile))
			throw new Error('audio_dubbing.wav not found');
		if (!existsSync(timingsFile)) throw new Error('timings.json not found');

		const data = await readJson(timingsFile, ctx);
		const dstLang = dstLangFromTranslation(data.translation);
		const subPath = join(metadataDir, `subtitles.${dstLang}.srt`);
		writeSrt(data.translation, ctx, subPath);
		const style = probeStyle(video_file_path, dstLang, probeOverrides);
		const escapedSub = subPath.replace(/'/g, "'\\\\''").replace(/'/g, "'\\''");

		const bgmGain = ctx.input?.stages?.merge_video?.bgmGain ?? 14;
		const mixedAudio = join(tmpDir, 'audio_mixed.m4a');
		ffmpeg([
			'-i',
			dubbingFile,
			'-i',
			bgmFile,
			'-filter_complex',
			`[1:a]volume=${bgmGain}dB[a1];[0:a][a1]amix=inputs=2:duration=longest:normalize=0,acompressor=threshold=-24dB:ratio=2:makeup=2dB,alimiter=limit=-1dB[aout]`,
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
				`subtitles='${escapedSub}':force_style='${style}'`,
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

	await setStage(sessionPath, 'merge_video', {
		status: 'succeeded',
		completed_at: nowISO(),
		progress: 100,
		last_message: 'Merged',
	});

	const finalPath = `/api/video/${taskId}`;
	await setTask(sessionPath, { final_video_path: finalPath });
}
