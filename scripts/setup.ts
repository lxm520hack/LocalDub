import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');
const isWindows = process.platform === 'win32';

const scriptFile = isWindows
	? join(repoRoot, 'scripts', 'setup.ps1')
	: join(repoRoot, 'scripts', 'setup.sh');

if (! await Bun.file(scriptFile).exists()) {
	console.error(`[ERROR] 脚本不存在: ${scriptFile}`);
	process.exit(1);
}

const cmd = isWindows
	? ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile]
	: ['bash', scriptFile];

const result = Bun.spawnSync(cmd, {
	cwd: repoRoot,
	stdout: 'inherit',
	stderr: 'inherit',
	stdin: 'inherit',
});

process.exit(result.exitCode ?? 0);
