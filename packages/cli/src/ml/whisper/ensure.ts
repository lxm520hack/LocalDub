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
	// Prefer Release folder (DLLs live there on Windows) then common locations.
	const baseBin = join(whisperCppDir(), 'build', 'bin');
	const buildRoot = join(whisperCppDir(), 'build');
	const candidates: string[] = [];
	if (process.platform === 'win32') {
		// Prefer Release copy first (stable DLL layout)
		candidates.push(join(buildRoot, 'Release', 'whisper-cli.exe'));
		candidates.push(join(baseBin, 'whisper-cli.exe'));
		candidates.push(join(baseBin, 'whisper-vulkan.exe'));
		candidates.push(join(buildRoot, 'whisper-cli.exe'));
	} else {
		candidates.push(join(buildRoot, 'Release', 'whisper-cli'));
		candidates.push(join(baseBin, 'whisper-cli'));
		candidates.push(join(baseBin, 'whisper-vulkan'));
		candidates.push(join(buildRoot, 'whisper-cli'));
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

export function ensureWhisperCppBinary(sessionPath: string): boolean {
	const binPath = whisperVulkanPath();
	if (existsSync(binPath)) return true;

	emitLog(sessionPath, `[Whisper] whisper-vulkan not found at ${binPath}`);
	emitLog(sessionPath, '[Whisper] Build whisper.cpp with Vulkan:\n'
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
