import { readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { env, REPO_ROOT } from '@repo/config';
import { to } from '@repo/shared/lib/utils/try.ts';
import { type BaseConfigInput, ConfigSchema, type LocalInfo } from './types.ts';

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
 * 优先级 config.json > env > auto > defaults
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

export const localInfoPath = (sessionPath: string) =>
	join(sessionPath, 'metadata', 'local_info.json');

/**
 * readFileSync, JSON.parse 都可以抛错, 如何处理交给使用者
 */
export const readLocalInfo = (sessionPath: string) => {
	const path = localInfoPath(sessionPath);
	console.log(`[File] read ${path}`);
	const raw = JSON.parse(readFileSync(path, 'utf-8'));
	return raw as LocalInfo;
};
export const writeLocalInfo = (sessionPath: string, info: LocalInfo) => {
	const path = join(sessionPath, 'metadata', 'local_info.json');
	const raw = JSON.stringify(info, null, 2);
	writeFileSync(path, raw);
	const lines = raw.split('\n').length;
	console.log(`[File] write ${path} (${raw.length}B, ${lines} lines)`);
	return info;
};
export const setLocalInfo = (
	sessionPath: string,
	patch: Partial<LocalInfo>,
): void => {
	const existing = readLocalInfo(sessionPath) ?? ({} as LocalInfo);
	writeLocalInfo(sessionPath, { ...existing, ...patch });
	console.log(`[File] set ${localInfoPath(sessionPath)}:`, JSON.stringify(patch));
};
export const readPipeline = (sessionPath: string) =>
	readLocalInfo(sessionPath)?.pipeline || 'dub';
