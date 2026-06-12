import { readConfig } from '../config/config.ts';

export interface StageSpec {
	name: string;
	label: string;
}

export const DUB_STAGES: StageSpec[] = [
	{ name: 'download', label: 'Download' },
	{ name: 'separate', label: 'Demucs' },
	{ name: 'asr', label: 'Whisper' },
	{ name: 'asr_fix', label: 'Split sentences' },
	{ name: 'translate', label: 'Translate' },
	{ name: 'split_audio', label: 'Split audio' },
	{ name: 'tts', label: 'VoxCPM' },
	{ name: 'merge_audio', label: 'Merge audio' },
	{ name: 'merge_video', label: 'Merge video' },
];

export const SUBTITLE_STAGES: StageSpec[] = [
	{ name: 'download', label: 'Download' },
	{ name: 'separate', label: 'Demucs' },
	{ name: 'asr', label: 'Whisper' },
	{ name: 'asr_fix', label: 'Split sentences' },
	{ name: 'translate', label: 'Translate' },
	{ name: 'split_audio', label: 'Split audio' },
	{ name: 'merge_video', label: 'Merge video' },
];

function withOcr(stages: StageSpec[], pipeline?: string): StageSpec[] {
	const drop = new Set(['asr', 'asr_fix', 'separate']);
	if (pipeline === 'subtitle') drop.add('separate'); // already in set, no-op
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

/** Build stage list based on pipeline mode and subtitleSource config */
export function getStages(pipeline?: string): StageSpec[] {
	let stages = pipeline === 'subtitle' ? SUBTITLE_STAGES : DUB_STAGES;
	try {
		const cfg = readConfig();
		const src = cfg.subtitleSource ?? 'asr';
		if (src === 'ocr') stages = withOcr(stages, pipeline);
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
