import { readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { env, REPO_ROOT } from '@repo/config';
import { to } from '@repo/shared/lib/utils/try.ts';
import {
	type ASREngineConfig,
	type BaseConfigInput,
	ConfigSchema,
	type SeparateEngineConfig,
	type TasksConfig,
	type TranslateEngineConfig,
	type TTSEngineConfig,
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

/**
 * 优先级 config.json > env > defaults
 * 不处理错误, 如果错误, 使用者应该立即知道 并做出调整
 */
export const readConfig = (path?: string) => {
	const configPath = path ?? CONFIG_PATH;
	const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
	const config = ConfigSchema.parse(raw);
	return {
		...config,
		stages: {
			...config?.stages,
			translate: {
				...config?.stages?.translate,
				apiBase: config?.stages?.translate?.apiBase ?? env.OPENAI_BASE_URL,
				model: config?.stages?.translate?.model ?? env.OPENAI_MODEL,
			},
		},
	};
};

export function readTasksConfig(path?: string): TasksConfig {
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
