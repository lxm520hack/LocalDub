import { readInputArgs } from '../input/input.ts';
import { StageName } from '../input/types.ts';

export const DUB_STAGES: StageName[] = [
	'separate',
	'separate_after',
	'asr',
	'asr_fix',
	'translate',
	'split_audio',
	'tts',
	'merge_audio',
	'merge_video',
];

export const SUBTITLE_STAGES: StageName[] = [
	'separate',
	'separate_after',
	'asr',
	'asr_fix',
	'translate',
	'split_audio',
	'merge_video',
];

function withOcrStages(stages: StageName[], pipeline?: string): StageName[] {
	const drop = new Set(['asr', 'asr_fix', 'separate', 'separate_after']);
	if (pipeline === 'subtitle') drop.add('separate');
	const filtered = stages.filter(s => !drop.has(s));
	const idx = filtered.findIndex(s => s === 'translate');
	const out = [...filtered];
	const ocrStages: StageName[] = [
		'ocr', 
		'ocr_fix', 
	];
	if (idx === -1) {
		out.push(...ocrStages);
	} else {
		out.splice(idx, 0, ...ocrStages);
	}
	return out;
}

function withAsrOcrStages(stages: StageName[], _pipeline?: string): StageName[] {
	const out: StageName[] = [];
	for (const s of stages) {
		if (s === 'asr_fix' || s === 'ocr' || s === 'ocr_fix') continue;
		out.push(s);
		if (s === 'asr') {
			out.push('asr_ocr_pre',);
			out.push('asr_ocr',);
			out.push('asr_ocr_fix',);
		}
	}
	return out;
}

/** Build stage list based on pipeline mode and subtitleSource config */
export function getStages(pipeline?: string): StageName[] {
	let stages = pipeline === 'subtitle' ? SUBTITLE_STAGES : DUB_STAGES;
	try {
		const args = readInputArgs();
		const src = args.subtitleSource ?? 'asr';
		if (src === 'ocr') stages = withOcrStages(stages, pipeline);
		else if (src === 'asr_ocr') stages = withAsrOcrStages(stages, pipeline);
		if (args.stages?.translate?.enabled === false) {
			stages = stages.filter(s => s !== 'translate');
		}
		if (pipeline === 'subtitle' && args.stages?.split_audio?.vadAlign !== true) {
			stages = stages.filter(s => s !== 'split_audio');
		}
	} catch {
		// config may not be available (e.g. import time); use default
	}
	return stages;
}

