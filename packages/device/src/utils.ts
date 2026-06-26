import { execSync } from 'node:child_process';
import * as os from 'node:os';

export function run(cmd: string, timeout = 3000): string {
	try {
		return execSync(cmd, { encoding: 'utf8', timeout, cwd: os.tmpdir() }).trim();
	} catch {
		return '';
	}
}

export const bytesToGB = (bytes: number | string) => {
	if (typeof bytes === 'string') {
		return parseFloat(bytes) / 1024 / 1024 / 1024;
	}
	return bytes / 1024 / 1024 / 1024;
};
export const fmtBytes = (bytes: number | string): string =>
	`${bytesToGB(bytes).toFixed(1)} GB`;
