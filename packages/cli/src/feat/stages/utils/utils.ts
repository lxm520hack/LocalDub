import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { env, LOG_DIR, REPO_ROOT, WORKFOLDER } from '@repo/config';
import { getStages } from '../../tasks/stages.ts';

export function defaultWhisperCppModelPath(): string {
	if (process.platform === 'win32') {
		return join(homedir(), 'AppData', 'Local', 'pywhispercpp', 'ggml-large-v3-turbo.bin');
	}
	return join(homedir(), '.cache', 'pywhispercpp', 'ggml-large-v3-turbo.bin');
}

/** Get the downloaded video source path for a session. */
export function videoSourcePath(sessionPath: string): string {
	return join(sessionPath, 'download', 'video_source.mp4');
}

/** Get the vocals stem path from separate stage. */
export function vocalsPath(sessionPath: string): string {
	return join(sessionPath, 'separate', 'target_3_vocals.wav');
}

/** Get the BGM stem path from separate_after stage. */
export function bgmPath(sessionPath: string): string {
	return join(sessionPath, 'separate_after', 'target_bgm.wav');
}

/** Get the separate stage output directory. */
export function separateDir(sessionPath: string): string {
	return join(sessionPath, 'separate');
}

/** Get the ASR output directory. */
export function asrDir(sessionPath: string): string {
	return join(sessionPath, 'asr');
}

/** Get the separate_after output directory. */
export function separateAfterDir(sessionPath: string): string {
	return join(sessionPath, 'separate_after');
}

export function defaultFont(dstLang: string): string {
	if (dstLang !== 'zh') return 'Arial';
	switch (process.platform) {
		case 'win32': return 'Microsoft YaHei';
		case 'darwin': return 'PingFang SC';
		default: return 'Noto Sans CJK SC';
	}
}
import type { SubtitleSource, TargetLang } from '../../config/types.ts';
import {  readConfig } from '../../config/config.ts';
import { _readCtx, Context,  getTaskId,  listStage,  readCtx, Task, TaskStage } from '../../context/context.ts';

export function nowISO(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, '');
}

export function probeVideoResolution(videoPath: string): { width: number; height: number } {
	const r = spawnSync('ffprobe', [
		'-v', 'error',
		'-select_streams', 'v:0',
		'-show_entries', 'stream=width,height',
		'-of', 'csv=p=0',
		videoPath,
	], { stdio: ['pipe', 'pipe', 'pipe'] });
	const [w, h] = r.stdout.toString().trim().split(',').map(Number);
	return { width: w, height: h };
}

export function probeSampleRate(audioPath: string): number {
	const r = spawnSync('ffprobe', [
		'-v', 'error',
		'-show_entries', 'stream=sample_rate',
		'-of', 'csv=p=0',
		audioPath,
	], { stdio: ['pipe', 'pipe', 'pipe'] });
	return parseInt(r.stdout.toString().trim()) || 48000;
}

export function probeDuration(audioPath: string): number {
	const r = spawnSync('ffprobe', [
		'-v', 'error',
		'-show_entries', 'format=duration',
		'-of', 'csv=p=0',
		audioPath,
	], { stdio: ['pipe', 'pipe', 'pipe'] });
	return parseFloat(r.stdout.toString().trim()) || 0;
}

function ffmpegInstallHint(): string {
	switch (process.platform) {
		case 'win32':
			return 'winget install Gyan.FFmpeg';
		case 'darwin':
			return 'brew install ffmpeg';
		case 'linux': {
			if (existsSync('/usr/bin/apt-get')) return 'sudo apt install -y ffmpeg';
			if (existsSync('/usr/bin/pacman')) return 'sudo pacman -S ffmpeg';
			if (existsSync('/sbin/apk')) return 'apk add ffmpeg';
			return 'sudo apt install -y ffmpeg';
		}
		default:
			return 'sudo apt install -y ffmpeg';
	}
}

import { fileLog, readJson } from './fileOps.ts';
import { to } from '@repo/shared/lib/utils/try.ts';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function broadcastUpdate(_table: string, _mutations: any[]) {
	// CLI 模式下不发送 socket 事务
}

// export async function updateTaskDB(
// 	taskId: string,
// 	fields: Record<string, unknown>,
// ) {
// 	if (Object.keys(fields).length === 0) return;
// 	await db.update(tasks).set(fields).where(eq(tasks.id, taskId));
// 	broadcastUpdate('tasks', [
// 		{ type: 'update', id: taskId, data: fields as any },
// 	]);
// }

// export async function updateStageDB(
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
// 	broadcastUpdate('task_stages', [
// 		{
// 			type: 'update',
// 			id: `${taskId}_${name}`,
// 			data: { task_id: taskId, name, ...fields } as any,
// 		},
// 	]);
// }

export const LANG_NAMES: Record<string, string> = {
	en: 'English',
	zh: 'Chinese',
	vi: 'Vietnamese',
	ja: 'Japanese',
	ko: 'Korean',
	fr: 'French',
	de: 'German',
	es: 'Spanish',
	pt: 'Portuguese',
	ru: 'Russian',
	ar: 'Arabic',
	hi: 'Hindi',
	th: 'Thai',
	id: 'Indonesian',
	ms: 'Malay',
	tl: 'Tagalog',
	my: 'Burmese',
	km: 'Khmer',
	lo: 'Lao',
	mn: 'Mongolian',
	ne: 'Nepali',
	ur: 'Urdu',
	bn: 'Bengali',
};

export function readTaskLanguages(ctx: Context): {
	asrLanguage: string;
	targetLanguage: TargetLang;
} {
	if (ctx) {
		return {
			asrLanguage: ctx.asr_language || 'en',
			targetLanguage: ctx.target_language || 'zh',
		};
	}
	return { asrLanguage: 'en', targetLanguage: 'zh' };
}

export function translationFilePath(sessionPath: string, lang: string): string {
	return join(sessionPath, 'translate', `translation.${lang}.json`);
}

export function subtitleFilePath(sessionPath: string, src: SubtitleSource = 'asr'): string {
	if (src === 'ocr') {
		const fixFile = join(sessionPath, 'ocr_fix', 'ocr_fix.json');
		if (existsSync(fixFile)) return fixFile;
	}
	if (src === 'asr_ocr') {
		const fixFile = join(sessionPath, 'asr_ocr_fix', 'asr_ocr_fused.json');
		if (existsSync(fixFile)) return fixFile;
	}
	return join(sessionPath, 'asr_fix', 'asr_fix.json');
}

export function timingsFilePath(sessionPath: string): string {
	return join(sessionPath, 'split_audio', 'timings.json');
}




export function mixedVocalsPath(sessionPath: string): string {
	return join(sessionPath, 'separate_after', 'target_3_vocals_mixed.wav');
}

export function gatedVocalsPath(sessionPath: string): string {
	return join(sessionPath, 'separate_after', 'target_3_vocals_gated.wav');
}



export function dubbingPath(sessionPath: string): string {
	return join(sessionPath, 'merge_audio', 'audio_dubbing.wav');
}









export function finalVideoFilename(taskId: string, pipeline: string, subtitleSource: SubtitleSource, noTranslate: boolean): string {
	const suffix = subtitleSource === 'asr_ocr' ? '_asr_ocr' : subtitleSource === 'ocr' ? '_ocr' : '';
	const ntlSuffix = noTranslate ? '_ntl' : '';
	const mode = pipeline === 'subtitle' ? 'subtitle' : 'dub';
	return `${taskId}_${mode}${suffix}${ntlSuffix}.mp4`;
}

export function srtTime(ms: number): string {
	const h = Math.floor(ms / 3600000);
	const m = Math.floor((ms % 3600000) / 60000);
	const s = Math.floor((ms % 60000) / 1000);
	const ml = ms % 1000;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ml).padStart(3, '0')}`;
}

export function emitLog(sessionPath: string, line: string) {
	const tid = getTaskId(sessionPath);
	console.log(line);
	if (!tid) return;
	const ts = nowISO();
	const logPath = join(sessionPath, `${tid}.log`);
	appendFileSync(logPath, `[${ts}] ${line}\n`);
}

export function ffmpeg(args: string[], timeout = 120_000) {
	const r = spawnSync(env.FFMPEG_PATH, ['-y', ...args], {
		stdio: ['pipe', 'pipe', 'pipe'],
		timeout,
	});
	if (r.error) {
		const e = r.error as NodeJS.ErrnoException;
		if (e.code === 'ENOENT')
			throw new Error(
				`ffmpeg not found. Try: ${ffmpegInstallHint()}\nOr set FFMPEG_PATH in .env (currently "${env.FFMPEG_PATH}").\nDetails: ${e.message}`,
			);
		throw new Error(`ffmpeg failed: ${e.message}`);
	}
	if (r.status !== 0)
		throw new Error(
			`ffmpeg exit ${r.status}: ${r.stderr.toString().slice(-2000)}`,
		);
}



function msDiff(a?: string | null, b?: string | null): number | null {
	if (!a || !b) return null;
	return Math.max(0, new Date(a).getTime() - new Date(b).getTime());
}

function fmtDuration(ms: number | null): string {
	if (ms == null) return '—';
	if (ms < 1000) return `${ms}ms`;
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	return `${Math.floor(s / 60)}m${s % 60}s`;
}

function enrichStage(s: TaskStage) {
	return {
		...s,
		progress: s.progress ?? 0,
		duration_ms: msDiff(s.completed_at, s.started_at),
	};
}

function buildSummary(
	stages: ReturnType<typeof enrichStage>[],
	task: Task
): string {
	const done = stages.filter((s) => s.status === 'completed').length;
	const total = stages.length;
	const elapsedMs = msDiff(new Date().toISOString(), task.created_at) ?? 0;
	const elapsed = fmtDuration(elapsedMs);
	const stage = stages.find((s) => s.status === 'running');
	const stageInfo = stage ? ` @ ${stage.label} (${stage.progress ?? 0}%)` : '';
	return task.status === 'completed'
		? `✅ completed in ${elapsed}`
		: `${task.status}${stageInfo} — ${done}/${total} stages done, elapsed ${elapsed}`;
}

export async function getStageStatuses(sessionPath: string) {
	const { task, stages: rows = []} =  _readCtx(sessionPath); // ensure ctx exists and is valid
	const pipeline = readCtx(sessionPath)?.pipeline || 'dub';

	const stageSpecs = getStages(pipeline);
	const stageMap = new Map(rows.map((r) => [r.name, r]));
	const stages = stageSpecs.map((s) =>
		enrichStage(
			stageMap.get(s.name) ?? {
				name: s.name,
				label: s.label,
				status: 'pending',
				progress: 0,
				last_message: null,
				error_message: null,
				started_at: null,
				completed_at: null,
			},
		),
	);

	return {
		taskId: task.id,
		url: task.url,
		title: task.title,
		status: task.status,
		current_stage: task.current_stage,
		created_at: task.created_at,
		started_at: task.started_at,
		completed_at: task.completed_at,
		session_path: task.session_path,
		final_video_path: task.final_video_path,
		error_message: task.error_message,
		stages,
		summary: buildSummary(stages, task),
	};
}
