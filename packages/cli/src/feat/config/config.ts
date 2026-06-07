import { readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { env, REPO_ROOT } from '@repo/config';
import type {
	ASREngineConfig,
	SeparateEngineConfig,
	TasksConfig,
	TranslateEngineConfig,
	TTSEngineConfig,
} from './types.ts';

export type {
	ASREngineConfig,
	SeparateEngineConfig,
	TasksConfig,
	TranslateEngineConfig,
	TTSEngineConfig,
};
export { delimiter, REPO_ROOT };

export function pythonBin(): string {
	const isWin = process.platform === 'win32';
	return join(
		REPO_ROOT,
		'.venv',
		isWin ? 'Scripts' : 'bin',
		isWin ? 'python.exe' : 'python',
	);
}

const CONFIG_PATH = join(REPO_ROOT, 'packages', 'cli', 'config.json');

export function readConfig(path?: string): TasksConfig {
	const configPath = path ?? CONFIG_PATH;
	let file: any = {};
	try {
		file = JSON.parse(readFileSync(configPath, 'utf-8'));
	} catch {
		/* use defaults */
	}
	const e = file.engines ?? {};
	return {
		tts: {
			runtime: e.tts?.runtime ?? 'pytorch',
			device: e.tts?.device ?? 'cuda',
		},
		asr: {
			runtime: e.asr?.runtime ?? 'pytorch',
			device: e.asr?.device ?? 'cuda',
		},
		translate: {
			apiBase: e.translate?.apiBase ?? env.OPENAI_BASE_URL,
			model: e.translate?.model ?? env.OPENAI_MODEL,
		},
		separate: {
			runtime: e.separate?.runtime ?? 'ort',
			device: e.separate?.device ?? 'cpu',
		},
	};
}
