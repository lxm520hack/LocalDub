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
	// Prefer Release or bin/Release copies then common locations.
	const baseBin = join(whisperCppDir(), 'build', 'bin');
	const buildRoot = join(whisperCppDir(), 'build');

	const candidates: string[] = [];
	if (process.platform === 'win32') {
		candidates.push(join(buildRoot, 'Release', 'whisper-cli.exe'));
		candidates.push(join(baseBin, 'Release', 'whisper-cli.exe'));
		candidates.push(join(baseBin, 'whisper-cli.exe'));
		candidates.push(join(baseBin, 'whisper-vulkan.exe'));
		candidates.push(join(buildRoot, 'whisper-cli.exe'));
		candidates.push(join(buildRoot, 'bin', 'whisper-cli.exe'));
		candidates.push(join(buildRoot, 'bin', 'whisper-vulkan.exe'));
		candidates.push(join(buildRoot, 'Release', 'whisper-vulkan.exe'));
	} else {
		candidates.push(join(buildRoot, 'Release', 'whisper-cli'));
		candidates.push(join(baseBin, 'Release', 'whisper-cli'));
		candidates.push(join(baseBin, 'whisper-cli'));
		candidates.push(join(baseBin, 'whisper-vulkan'));
		candidates.push(join(buildRoot, 'whisper-cli'));
		candidates.push(join(buildRoot, 'bin', 'whisper-cli'));
		candidates.push(join(buildRoot, 'bin', 'whisper-vulkan'));
		candidates.push(join(buildRoot, 'Release', 'whisper-vulkan'));
	}

	for (const c of candidates) {
		if (existsSync(c)) return c;
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

function autoInstallVulkan(sessionPath: string): boolean {
	const { spawnSync } = require('child_process');
	const os = require('os');
	if (process.platform === 'win32') {
		// Try winget, then choco
		emitLog(sessionPath, '[Whisper] Attempting to install Vulkan SDK on Windows (winget/choco)');
		let r = spawnSync('winget', ['install', '--id', 'LunarG.VulkanSDK', '-e', '--accept-package-agreements', '--accept-source-agreements'], { timeout: 600_000 });
		if (r.status === 0) return true;
		emitLog(sessionPath, `[Whisper] winget install failed (exit ${r.status}), trying choco`);
		r = spawnSync('choco', ['install', 'vulkan-sdk', '-y'], { timeout: 600_000 });
		if (r.status === 0) return true;
		emitLog(sessionPath, `[Whisper] choco install failed (exit ${r.status})`);
		return false;
	} else if (process.platform === 'linux') {
		emitLog(sessionPath, '[Whisper] Attempting to install Vulkan SDK on Linux via apt');
		let r = spawnSync('bash', ['-lc', 'sudo apt-get update && sudo apt-get install -y vulkan-sdk || sudo apt-get install -y libvulkan1 vulkan-utils'], { timeout: 600_000 });
		if (r.status === 0) return true;
		emitLog(sessionPath, `[Whisper] apt-get install failed (exit ${r.status})`);
		return false;
	} else if (process.platform === 'darwin') {
		emitLog(sessionPath, '[Whisper] macOS detected: attempting to install Vulkan SDK via brew (MoltenVK)');
		let r = spawnSync('brew', ['install', 'vulkan-sdk'], { timeout: 600_000 });
		if (r.status === 0) return true;
		emitLog(sessionPath, `[Whisper] brew install failed (exit ${r.status})`);
		return false;
	}
	return false;
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
		const stderr = (r.stderr||'').toString();
		// If Vulkan not found, attempt to auto-install Vulkan SDK then retry configure
		if (stderr.includes('Could NOT find Vulkan') || stderr.includes('FindVulkan') || stderr.includes('Vulkan_LIBRARY')) {
			emitLog(sessionPath, '[Whisper] Vulkan not detected. Attempting automatic Vulkan SDK install (platform-specific)');
			try {
				if (!autoInstallVulkan(sessionPath)) {
					emitLog(sessionPath, '[Whisper] Automatic Vulkan install failed');
					return false;
				}
			} catch (e) {
				emitLog(sessionPath, `[Whisper] Exception while trying to install Vulkan: ${e?.message || e}`);
				return false;
			}
			// Retry configure with Vulkan enabled
			emitLog(sessionPath, '[Whisper] Retrying: cmake -B build -DGGML_VULKAN=1');
			r = spawnSync('cmake', ['-B', 'build', '-DGGML_VULKAN=1'], { cwd, timeout: 600_000 });
			if (r.status !== 0) {
				emitLog(sessionPath, `[Whisper] cmake configure still failed after Vulkan install (exit ${r.status}) stdout=${(r.stdout||'').toString().slice(-2000)} stderr=${(r.stderr||'').toString().slice(-2000)}`);
				return false;
			}
		} else {
			return false;
		}
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
