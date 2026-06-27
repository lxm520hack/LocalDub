import { readInputArgs } from '../config/config.ts';

export interface StageSpec {
	name: string;
	label: string;
}

export const DUB_STAGES: StageSpec[] = [
	{ name: 'separate', label: 'Demucs' },
	{ name: 'separate_after', label: 'Mix BGM' },
	{ name: 'asr', label: 'Whisper' },
	{ name: 'asr_fix', label: 'Split sentences' },
	{ name: 'translate', label: 'Translate' },
	{ name: 'split_audio', label: 'Split audio' },
	{ name: 'tts', label: 'VoxCPM' },
	{ name: 'merge_audio', label: 'Merge audio' },
	{ name: 'merge_video', label: 'Merge video' },
];

export const SUBTITLE_STAGES: StageSpec[] = [
	{ name: 'separate', label: 'Demucs' },
	{ name: 'separate_after', label: 'Mix BGM' },
	{ name: 'asr', label: 'Whisper' },
	{ name: 'asr_fix', label: 'Split sentences' },
	{ name: 'translate', label: 'Translate' },
	{ name: 'split_audio', label: 'Split audio' },
	{ name: 'merge_video', label: 'Merge video' },
];

function withOcrStages(stages: StageSpec[], pipeline?: string): StageSpec[] {
	const drop = new Set(['asr', 'asr_fix', 'separate', 'separate_after']);
	if (pipeline === 'subtitle') drop.add('separate');
	const filtered = stages.filter(s => !drop.has(s.name));
	const idx = filtered.findIndex(s => s.name === 'translate');
	const out = [...filtered];
	const ocrStages: StageSpec[] = [
		{ name: 'ocr', label: 'OCR' },
		{ name: 'ocr_fix', label: 'OCR Fix' },
	];
	if (idx === -1) {
		out.push(...ocrStages);
	} else {
		out.splice(idx, 0, ...ocrStages);
	}
	return out;
}

function withAsrOcrStages(stages: StageSpec[], _pipeline?: string): StageSpec[] {
	const out: StageSpec[] = [];
	for (const s of stages) {
		if (s.name === 'asr_fix' || s.name === 'ocr' || s.name === 'ocr_fix') continue;
		out.push(s);
		if (s.name === 'asr') {
			out.push({ name: 'asr_ocr_pre', label: 'OCR Pre' });
			out.push({ name: 'asr_ocr', label: 'OCR' });
			out.push({ name: 'asr_ocr_fix', label: 'Fix Overlap' });
		}
	}
	return out;
}

/** Build stage list based on pipeline mode and subtitleSource config */
export function getStages(pipeline?: string): StageSpec[] {
	let stages = pipeline === 'subtitle' ? SUBTITLE_STAGES : DUB_STAGES;
	try {
		const cfg = readInputArgs();
		const src = cfg.subtitleSource ?? 'asr';
		if (src === 'ocr') stages = withOcrStages(stages, pipeline);
		else if (src === 'asr_ocr') stages = withAsrOcrStages(stages, pipeline);
		if (cfg.stages?.translate?.enabled === false) {
			stages = stages.filter(s => s.name !== 'translate');
		}
		if (pipeline === 'subtitle' && cfg.stages?.split_audio?.vadAlign !== true) {
			stages = stages.filter(s => s.name !== 'split_audio');
		}
	} catch {
		// config may not be available (e.g. import time); use default
	}
	return stages;
}

/** @deprecated Use DUB_STAGES or getStages(pipeline) */
export const STAGES = DUB_STAGES;

export const DUB_STAGE_NAMES = DUB_STAGES.map((s) => s.name);
export const SUBTITLE_STAGE_NAMES = SUBTITLE_STAGES.map((s) => s.name);
export const STAGE_NAMES = DUB_STAGE_NAMES;
