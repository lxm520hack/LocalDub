// 脚本, cli

import { REPO_ROOT } from "./root";
import { join } from 'node:path';

export function pythonBin(): string {
	const isWin = process.platform === 'win32';
	return join(
		REPO_ROOT,
		'.venv',
		isWin ? 'Scripts' : 'bin',
		isWin ? 'python.exe' : 'python',
	);
}

export const VOXCPM_TORCH_GRADIO_MAIN = join(REPO_ROOT, 'packages', 'voxcpm_torch_server', 'server.py');