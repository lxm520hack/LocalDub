import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { REPO_ROOT } from '../../feat/config/config.ts';
import { emitLog } from '../../feat/stages/utils/utils.ts';

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

let _builtBinary: string | null = null;

export function whisperCppBuildDir(): string {
	return join(REPO_ROOT, 'submodule', 'whisper.cpp', 'build');
}

export function whisperCppBinaryPath(): string {
	if (_builtBinary) return _builtBinary;
	const binDir = join(whisperCppBuildDir(), 'bin');
	const ext = process.platform === 'win32' ? '.exe' : '';
	for (const name of ['whisper-vulkan', 'whisper-cpu', 'whisper-cli', 'whisper']) {
		const p = join(binDir, `${name}${ext}`);
		if (existsSync(p)) {
			_builtBinary = p;
			return p;
		}
		const pRel = join(binDir, 'Release', `${name}${ext}`);
		if (existsSync(pRel)) {
			copyFileSync(pRel, p);
			_builtBinary = p;
			return p;
		}
	}
	return join(binDir, `whisper-vulkan${ext}`);
}

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
	emitLog(sessionPath, `[Whisper] Downloaded to ${dest}`);
	return true;
}

export function ensureWhisperCppSubmodule(sessionPath: string): boolean {
	const gitDir = join(whisperCppDir(), '.git');
	if (existsSync(gitDir)) {
		emitLog(sessionPath, '[Whisper] whisper.cpp submodule OK');
		return true;
	}

	emitLog(sessionPath, '[Whisper] whisper.cpp submodule not found, initializing...');
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
	if (existsSync(dest)) {
		emitLog(sessionPath, '[Whisper] Whisper model OK');
		return true;
	}

	const url = `${HF_BASE}/ggml-large-v3-turbo.bin`;
	emitLog(sessionPath, `[Whisper] Whisper model not found at ${dest}, downloading...`);
	return downloadFile(url, dest, sessionPath);
}

export function ensureVadModel(sessionPath: string): boolean {
	const dest = join(modelsDir(), vadModelFilename());
	if (existsSync(dest)) {
		emitLog(sessionPath, '[Whisper] VAD model OK');
		return true;
	}

	if (!ensureWhisperCppSubmodule(sessionPath)) return false;

	const url = `${HF_BASE}/${vadModelFilename()}`;
	emitLog(sessionPath, `[Whisper] VAD model not found at ${dest}, downloading...`);
	return downloadFile(url, dest, sessionPath);
}

// ---- Vulkan SDK ----

const VK_SDK_VERSION = '1.3.296.0';
const VK_SDK_INSTALLER_URL =
	`https://sdk.lunarg.com/sdk/download/${VK_SDK_VERSION}/windows/VulkanSDK-${VK_SDK_VERSION}-Installer.exe`;

let _vkSdkDir: string | null = null;

function findVulkanSdkDir(): string | null {
	if (_vkSdkDir && existsSync(join(_vkSdkDir, 'Include', 'vulkan', 'vulkan.h'))) return _vkSdkDir;

	const candidates = [
		process.env.VK_SDK_PATH,
		join('C:\\', 'VulkanSDK', VK_SDK_VERSION),
		join(process.env.ProgramFiles || 'C:\\Program Files', 'VulkanSDK', VK_SDK_VERSION),
		join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VulkanSDK', VK_SDK_VERSION),
	];
	for (const dir of candidates) {
		if (dir && existsSync(join(dir, 'Include', 'vulkan', 'vulkan.h'))) {
			_vkSdkDir = dir;
			return dir;
		}
	}
	return null;
}

function isVulkanSdkInstalled(): boolean {
	return findVulkanSdkDir() !== null;
}

function installVulkanSdkWinget(sessionPath: string): boolean {
	emitLog(sessionPath, '[Whisper] Installing Vulkan SDK via winget...');
	emitLog(sessionPath, '[Whisper] This may open a UAC prompt (admin required)');
	const r = spawnSync('winget', ['install', '-e', '--id', 'KhronosGroup.VulkanSDK', '--accept-package-agreements'],
		{ timeout: 600_000 });
	if (r.status !== 0) {
		const err = r.stderr?.toString() || '';
		emitLog(sessionPath, `[Whisper] winget install failed (exit ${r.status}):\n${err.slice(-300)}`);
		return false;
	}
	emitLog(sessionPath, '[Whisper] Vulkan SDK installed via winget');
	return true;
}

function installVulkanSdkInstaller(sessionPath: string): boolean {
	const tmpDir = join(REPO_ROOT, 'packages', 'tmp');
	const installerPath = join(tmpDir, `VulkanSDK-${VK_SDK_VERSION}-Installer.exe`);

	if (!downloadFile(VK_SDK_INSTALLER_URL, installerPath, sessionPath)) return false;

	emitLog(sessionPath, `[Whisper] Running Vulkan SDK installer (${VK_SDK_VERSION})...`);
	emitLog(sessionPath, '[Whisper] This may open a UAC prompt (admin required)');
	const r = spawnSync(`"${installerPath}"`, ['/S'], {
		timeout: 600_000,
		shell: true,
	});
	if (r.status !== 0) {
		emitLog(sessionPath, `[Whisper] Vulkan SDK installer failed (exit ${r.status})`);
		emitLog(sessionPath, `[Whisper] Install manually: ${VK_SDK_INSTALLER_URL}`);
		return false;
	}
	emitLog(sessionPath, '[Whisper] Vulkan SDK installed');
	return true;
}

function ensureVulkanSdk(sessionPath: string): boolean {
	if (isVulkanSdkInstalled()) {
		emitLog(sessionPath, '[Whisper] Vulkan SDK OK');
		return true;
	}

	emitLog(sessionPath, '[Whisper] Vulkan SDK not found');
	if (installVulkanSdkWinget(sessionPath) && isVulkanSdkInstalled()) return true;
	if (installVulkanSdkInstaller(sessionPath) && isVulkanSdkInstalled()) return true;

	emitLog(sessionPath, '[Whisper] Vulkan SDK install failed. Install manually:\n'
		+ `  winget install -e --id KhronosGroup.VulkanSDK\n`
		+ `  Or download: ${VK_SDK_INSTALLER_URL}`);
	return false;
}

// ---- Build ----

function tryBuild(sessionPath: string): boolean {
	const buildDir = whisperCppBuildDir();
	const args = ['-B', buildDir, '-S', whisperCppDir(), '-DGGML_VULKAN=1'];

	emitLog(sessionPath, '[Whisper] cmake configure (Vulkan)...');
	const buildEnv: Record<string, string> = { ...process.env as Record<string, string> };
	const vkDir = findVulkanSdkDir();
	if (vkDir) {
		buildEnv['VULKAN_SDK'] = vkDir;
		buildEnv['SPIRV-Headers_DIR'] = join(vkDir, 'Lib', 'cmake');
	}
	const cfg = spawnSync('cmake', args, { timeout: 120_000, env: buildEnv });
	if (cfg.status !== 0) {
		const err = cfg.stderr?.toString() || '';
		emitLog(sessionPath, `[Whisper] cmake configure (Vulkan) failed:\n${err.slice(-500)}`);
		return false;
	}

	emitLog(sessionPath, '[Whisper] cmake build (Vulkan)...');
	const build = spawnSync('cmake', ['--build', buildDir, '--config', 'Release', '-j', '4'],
		{ timeout: 600_000 });
	if (build.status !== 0) {
		const err = build.stderr?.toString() || '';
		emitLog(sessionPath, `[Whisper] cmake build (Vulkan) failed:\n${err.slice(-500)}`);
		return false;
	}

	const binPath = whisperCppBinaryPath();
	if (existsSync(binPath)) {
		emitLog(sessionPath, `[Whisper] Built ${binPath}`);
		return true;
	}
	emitLog(sessionPath, `[Whisper] Build completed but binary not found at ${binPath}`);
	return false;
}

export function ensureWhisperCppBinary(sessionPath: string): boolean {
	const binPath = whisperCppBinaryPath();
	if (existsSync(binPath)) {
		emitLog(sessionPath, `[Whisper] whisper binary OK (${binPath})`);
		return true;
	}

	emitLog(sessionPath, '[Whisper] whisper-vulkan not found, checking Vulkan SDK...');
	if (!ensureVulkanSdk(sessionPath)) return false;

	emitLog(sessionPath, '[Whisper] Building whisper.cpp with Vulkan...');
	if (tryBuild(sessionPath)) return true;

	emitLog(sessionPath, '[Whisper] Build failed. Build manually:\n'
		+ `  cd submodule/whisper.cpp\n`
		+ `  cmake -B build -DGGML_VULKAN=1\n`
		+ `  cmake --build build --config Release -j4`);
	return false;
}

export function ensureWhisperCpp(sessionPath: string): boolean {
	if (!ensureWhisperCppSubmodule(sessionPath)) return false;
	if (!ensureWhisperCppModel(sessionPath)) return false;
	if (!ensureWhisperCppBinary(sessionPath)) return false;
	return true;
}
