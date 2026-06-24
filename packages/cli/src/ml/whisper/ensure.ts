import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { REPO_ROOT } from '../../feat/config/config.ts';
import { emitLog } from '../../feat/stages/utils/utils.ts';

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

function whisperCppDir(): string {
	return join(REPO_ROOT, 'submodule', 'whisper.cpp');
}

function modelsDir(): string {
	return join(whisperCppDir(), 'models');
}

function vadModelFilename(): string {
	return 'ggml-silero-vad-v6.2.0.bin';
}

function whisperModelPath(): string {
	if (process.platform === 'win32') {
		return join(homedir(), 'AppData', 'Local', 'pywhispercpp', 'ggml-large-v3-turbo.bin');
	}
	return join(homedir(), '.cache', 'pywhispercpp', 'ggml-large-v3-turbo.bin');
}

export function whisperVulkanPath(): string {
	// Explicitly prefer Release copy (stable DLL layout) to avoid intermittent selection
	const baseBin = join(whisperCppDir(), 'build', 'bin');
	const buildRoot = join(whisperCppDir(), 'build');
	const releasePathWin = join(buildRoot, 'Release', 'whisper-cli.exe');
	const releasePathUnix = join(buildRoot, 'Release', 'whisper-cli');
	const baseBinCliWin = join(baseBin, 'whisper-cli.exe');
	const baseBinCliUnix = join(baseBin, 'whisper-cli');
	const baseBinVulkanWin = join(baseBin, 'whisper-vulkan.exe');
	const baseBinVulkanUnix = join(baseBin, 'whisper-vulkan');

	if (process.platform === 'win32') {
		if (existsSync(releasePathWin)) return releasePathWin;
		if (existsSync(baseBinCliWin)) return baseBinCliWin;
		if (existsSync(baseBinVulkanWin)) return baseBinVulkanWin;
		if (existsSync(join(buildRoot, 'whisper-cli.exe'))) return join(buildRoot, 'whisper-cli.exe');
	} else {
		if (existsSync(releasePathUnix)) return releasePathUnix;
		if (existsSync(baseBinCliUnix)) return baseBinCliUnix;
		if (existsSync(baseBinVulkanUnix)) return baseBinVulkanUnix;
		if (existsSync(join(buildRoot, 'whisper-cli'))) return join(buildRoot, 'whisper-cli');
	}

	// Fallback to original expected path
	const fallback = process.platform === 'win32'
		? join(whisperCppDir(), 'build', 'bin', 'whisper-vulkan.exe')
		: join(whisperCppDir(), 'build', 'bin', 'whisper-vulkan');
	return fallback;
}

export function whisperCppBinaryPath(): string {
	return whisperVulkanPath();
}

function downloadFile(url: string, dest: string, sessionPath: string): boolean {
	const destDir = join(dest, '..');
	if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });

	emitLog(sessionPath, `[Whisper] Downloading ${url.split('/').pop()}...`);
	const r = spawnSync('curl.exe', ['-#L', '-o', dest, url], { timeout: 300_000 });
	if (r.status !== 0) {
		emitLog(sessionPath, `[Whisper] Download failed (curl exit ${r.status})`);
		return false;
	}
	if (!existsSync(dest)) {
		emitLog(sessionPath, `[Whisper] File not found after download: ${dest}`);
		return false;
	}
	emitLog(sessionPath, `[Whisper] Saved to ${dest}`);
	return true;
}

export function ensureWhisperCppSubmodule(sessionPath: string): boolean {
	const gitDir = join(whisperCppDir(), '.git');
	if (existsSync(gitDir)) return true;

	emitLog(sessionPath, '[Whisper] Initializing whisper.cpp submodule...');
	const r = spawnSync('git', ['submodule', 'update', '--init', 'submodule/whisper.cpp'], {
		timeout: 120_000,
		cwd: REPO_ROOT,
	});
	if (r.status !== 0) {
		emitLog(sessionPath, '[Whisper] Failed to init submodule. Run manually:\n'
			+ `  git submodule update --init submodule/whisper.cpp`);
		return false;
	}
	emitLog(sessionPath, '[Whisper] Submodule initialized');
	return true;
}

export function ensureWhisperCppModel(sessionPath: string): boolean {
	const dest = whisperModelPath();
	if (existsSync(dest)) return true;

	const url = `${HF_BASE}/ggml-large-v3-turbo.bin`;
	emitLog(sessionPath, `[Whisper] Whisper model not found at ${dest}`);
	return downloadFile(url, dest, sessionPath);
}

export function ensureVadModel(sessionPath: string): boolean {
	const dest = join(modelsDir(), vadModelFilename());
	if (existsSync(dest)) return true;

	if (!ensureWhisperCppSubmodule(sessionPath)) return false;

	const url = `${HF_BASE}/${vadModelFilename()}`;
	emitLog(sessionPath, `[Whisper] VAD model not found at ${dest}`);
	return downloadFile(url, dest, sessionPath);
}

function buildWhisperCpp(sessionPath: string): boolean {
	const { spawnSync } = require('child_process');
	const os = require('os');
	const cwd = whisperCppDir();

	emitLog(sessionPath, '[Whisper] Attempting to build whisper.cpp (cmake configure + build)...');

	// Check cmake availability
	let r = spawnSync('cmake', ['--version'], { cwd, timeout: 30_000 });
	if (r.status !== 0) {
		emitLog(sessionPath, `[Whisper] cmake not available or failed --version (exit ${r.status}). Install CMake or ensure it's on PATH.`);
		return false;
	}

	// Configure
	emitLog(sessionPath, `[Whisper] Running: cmake -B build -DGGML_VULKAN=1`);
	r = spawnSync('cmake', ['-B', 'build', '-DGGML_VULKAN=1'], { cwd, timeout: 600_000 });
	if (r.status !== 0) {
		emitLog(sessionPath, `[Whisper] cmake configure failed (exit ${r.status}) stdout=${(r.stdout||'').toString().slice(-2000)} stderr=${(r.stderr||'').toString().slice(-2000)}`);
		return false;
	}

	// Build
	const cpus = Math.max(2, (os.cpus && os.cpus().length) || 2);
	let buildArgs: string[];
	if (process.platform === 'win32') {
		buildArgs = ['--build', 'build', '--config', 'Release', '-j', String(cpus)];
	} else {
		buildArgs = ['--build', 'build', '-j', String(cpus)];
	}
	emitLog(sessionPath, `[Whisper] Running: cmake ${buildArgs.join(' ')}`);
	// Allow up to 1 hour for build on slow machines
	r = spawnSync('cmake', buildArgs, { cwd, timeout: 3_600_000 });
	if (r.status !== 0) {
		emitLog(sessionPath, `[Whisper] cmake build failed (exit ${r.status}) stdout=${(r.stdout||'').toString().slice(-2000)} stderr=${(r.stderr||'').toString().slice(-2000)}`);
		return false;
	}

	emitLog(sessionPath, '[Whisper] Build completed');
	return true;
}

export function ensureWhisperCppBinary(sessionPath: string): boolean {
	const binPath = whisperVulkanPath();
	if (existsSync(binPath)) return true;

	emitLog(sessionPath, `[Whisper] whisper-vulkan not found at ${binPath}`);

	// Attempt an automatic build once
	try {
		if (buildWhisperCpp(sessionPath)) {
			// re-evaluate path after build
			const newBin = whisperVulkanPath();
			if (existsSync(newBin)) {
				emitLog(sessionPath, `[Whisper] Found binary after build at ${newBin}`);
				return true;
			}
			// fallback: list build dir for diagnostics
			emitLog(sessionPath, `[Whisper] Build finished but binary still not found at ${newBin}`);
		} else {
			emitLog(sessionPath, '[Whisper] Automatic build attempt failed');
		}
	} catch (e) {
		emitLog(sessionPath, `[Whisper] Exception during automatic build: ${e?.message || e}`);
	}

	emitLog(sessionPath, '[Whisper] Build whisper.cpp with Vulkan (manual steps):\n'
		+ `  cd submodule/whisper.cpp\n`
		+ `  cmake -B build -DGGML_VULKAN=1\n`
		+ `  cmake --build build --config Release -j4\n`
		+ `  Or set WHISPER_MODEL to use a different runtime.`);
	return false;
}

export function ensureWhisperCpp(sessionPath: string): boolean {
	if (!ensureWhisperCppSubmodule(sessionPath)) return false;
	if (!ensureWhisperCppModel(sessionPath)) return false;
	if (!ensureWhisperCppBinary(sessionPath)) return false;
	return true;
}
