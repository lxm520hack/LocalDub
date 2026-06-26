import { readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { env, REPO_ROOT, WORKFOLDER, pythonBin } from '@repo/config';
import { to } from '@repo/shared/lib/utils/try.ts';
import { type BaseConfigInput, ConfigSchema,  } from './types.ts';
import { fileLog } from '../stages/utils/fileOps.ts';

export { delimiter, REPO_ROOT, pythonBin };

const CONFIG_PATH = join(REPO_ROOT, 'packages', 'cli', 'input.json');

/**
 * 优先级 input.json > env > auto > defaults
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

