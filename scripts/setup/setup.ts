#!/usr/bin/env bun
/**
 * LocalDub 环境设置入口
 * 统一管理子模块初始化、依赖安装等
 */
import { join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const repoRoot = resolve(import.meta.dir, '..');
const isWindows = process.platform === 'win32';

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function log(msg: string, color: 'green' | 'yellow' | 'red' | 'cyan' | 'gray' = 'green') {
	const colors: Record<string, string> = {
		green: '\x1b[32m',
		yellow: '\x1b[33m',
		red: '\x1b[31m',
		cyan: '\x1b[36m',
		gray: '\x1b[90m',
	};
	console.log(`${colors[color]}[SETUP] ${msg}\x1b[0m`);
}

function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): number {
	const r = Bun.spawnSync(cmd, {
		cwd: opts.cwd ?? repoRoot,
		stdout: 'inherit',
		stderr: 'inherit',
		env: { ...process.env, ...opts.env },
	});
	return r.exitCode ?? 0;
}

// ---------------------------------------------------------------------------
// 前置检测
// ---------------------------------------------------------------------------

function checkPrerequisites() {
	const missing: string[] = [];
	for (const cmd of ['bun', 'ffmpeg', 'python']) {
		if (!Bun.which(cmd)) missing.push(cmd);
	}
	if (missing.length > 0) {
		log(`缺少命令: ${missing.join(', ')}`, 'red');
		process.exit(1);
	}
	log('bun / ffmpeg / python 均已安装', 'green');
}

// ---------------------------------------------------------------------------
// GPU 检测
// ---------------------------------------------------------------------------

function detectGpu(): 'cuda' | 'cpu' {
	if (!isWindows) {
		const nvidia = run(['nvidia-smi'], { cwd: repoRoot });
		if (nvidia === 0) return 'cuda';
		return 'cpu';
	}
	// Windows: try nvidia-smi.exe
	const r = Bun.spawnSync(['nvidia-smi.exe'], { cwd: repoRoot });
	return r.exitCode === 0 ? 'cuda' : 'cpu';
}

// ---------------------------------------------------------------------------
// .env 检查
// ---------------------------------------------------------------------------

function checkEnv() {
	const envPath = join(repoRoot, '.env');
	const envExample = join(repoRoot, '.env.example');
	if (!existsSync(envPath) && existsSync(envExample)) {
		// Bun doesn't have cp, use spawn
		run(['cmd', '/c', 'copy', '.env.example', '.env'], { cwd: repoRoot });
		log('已创建 .env（请按需编辑）', 'yellow');
	} else {
		log('.env 已存在', 'gray');
	}
}

// ---------------------------------------------------------------------------
// Python 虚拟环境
// ---------------------------------------------------------------------------

function setupPython(venv: string, gpuMode: 'cuda' | 'cpu', skipPipUpgrade: boolean = false) {
	if (!existsSync(venv)) {
		log('创建虚拟环境...', 'yellow');
		run(['python', '-m', 'venv', venv], { cwd: repoRoot });
	}

	const pip = isWindows
		? join(venv, 'Scripts', 'pip.exe')
		: join(venv, 'bin', 'pip');

	if (!skipPipUpgrade) {
		log('升级 pip...', 'gray');
		const python = isWindows
			? join(venv, 'Scripts', 'python.exe')
			: join(venv, 'bin', 'python');
		run([python, '-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], { cwd: repoRoot });
	} else {
		log('跳过 pip 升级', 'gray');
	}

	// CUDA 时先安装 PyTorch CUDA 版本
	if (gpuMode === 'cuda') {
		const pytorchCu = join(repoRoot, 'requirements-pytorch-cu128.txt');
		if (existsSync(pytorchCu)) {
			log('安装 PyTorch CUDA 12.8...', 'yellow');
			run([pip, 'install', '-r', pytorchCu, '--quiet'], { cwd: repoRoot });
		}
	}

	// 安装其他依赖（CPU 时指定 index URL）
	const torchIndex = gpuMode === 'cpu'
		? ['--index-url', 'https://download.pytorch.org/whl/cpu']
		: [];

	log(`安装 Python 依赖 (${gpuMode})...`, 'yellow');
	const args = [pip, 'install', '-r', join(repoRoot, 'requirements.txt'), '--quiet'];
	if (torchIndex.length) args.push(...torchIndex);
	run(args, { cwd: repoRoot });
	log('Python 依赖完成', 'green');
}

// ---------------------------------------------------------------------------
// JS 依赖
// ---------------------------------------------------------------------------

function setupJs(nodeModules: string) {
	if (!existsSync(nodeModules)) {
		log('bun install...', 'yellow');
		run(['bun', 'install'], { cwd: repoRoot });
	} else {
		log('node_modules 已存在', 'gray');
	}
}

// ---------------------------------------------------------------------------
// 子模块初始化（根据 config.json）
// ---------------------------------------------------------------------------

interface CliConfig {
	stages?: {
		separate?: { runtime?: string };
		tts?: { runtime?: string };
	};
}

function setupSubmodules(config: CliConfig, venv: string) {
	const sepRuntime = config.stages?.separate?.runtime;
	const ttsRuntime = config.stages?.tts?.runtime;

	const needed: string[] = [];
	if (sepRuntime === 'pytorch' || sepRuntime === 'ggml') {
		needed.push('submodule/demucs');
	}
	if (sepRuntime === 'ggml') {
		needed.push('submodule/demucs.cpp');
	}
	if (ttsRuntime === 'pytorch') {
		needed.push('submodule/VoxCPM');
	}

	if (needed.length === 0) {
		log('No submodules needed based on config', 'gray');
		return;
	}

	const unique = [...new Set(needed)];
	for (const sm of unique) {
		const smPath = join(repoRoot, sm.replace('/', isWindows ? '\\' : '/'));
		const gitDir = join(smPath, '.git');
		if (existsSync(gitDir)) {
			log(`${sm} already initialized`, 'gray');
		} else {
			log(`Initializing ${sm}...`, 'yellow');
			const code = run(['git', 'submodule', 'update', '--init', sm], { cwd: repoRoot });
			if (code !== 0) {
				log(`Failed to init ${sm}`, 'red');
			}
		}
	}

	// 安装子模块依赖
	const python = isWindows
		? join(venv, 'Scripts', 'python.exe')
		: join(venv, 'bin', 'python');
	const pip = isWindows
		? join(venv, 'Scripts', 'pip.exe')
		: join(venv, 'bin', 'pip');

	// demucs 核心依赖（通过 requirements-demucs.txt）
	if (sepRuntime === 'pytorch' || sepRuntime === 'ggml') {
		const demucsReq = join(repoRoot, 'requirements-demucs.txt');
		if (existsSync(demucsReq)) {
			log('安装 demucs 核心依赖...', 'yellow');
			run([pip, 'install', '-r', demucsReq, '--quiet'], { cwd: repoRoot });
		}
	}

	// VoxCPM 依赖
	if (ttsRuntime === 'pytorch') {
		const voxcpmReq = join(repoRoot, 'requirements-voxcpm.txt');
		if (existsSync(voxcpmReq)) {
			log('安装 VoxCPM 依赖...', 'yellow');
			run([pip, 'install', '-r', voxcpmReq, '--quiet'], { cwd: repoRoot });
		}
	}

	// GGML binary check
	if (sepRuntime === 'ggml') {
		const ggmlBin = join(repoRoot, 'submodule', 'demucs.cpp', 'build', 'demucs_mt.cpp.main.exe');
		if (existsSync(ggmlBin)) {
			log(`GGML binary exists`, 'gray');
		} else {
			log('GGML binary not found, will build at runtime', 'yellow');
		}
	}
}

// ---------------------------------------------------------------------------
// C++ OCR 编译
// ---------------------------------------------------------------------------

function checkCommand(cmd: string): boolean {
	return Bun.which(cmd) !== null;
}

function setupOcrCpp() {
	// onnxruntime zip 解压后嵌套一层同名目录: .../onnxruntime-win-x64-1.26.0/onnxruntime-win-x64-1.26.0/
	const ortBase = join(repoRoot, 'packages', 'tmp', isWindows ? 'onnxruntime-win-x64-1.26.0' : 'onnxruntime-linux-x64-1.24.4');
	const ortExtDir = join(ortBase, isWindows ? 'onnxruntime-win-x64-1.26.0' : 'onnxruntime-linux-x64-1.24.4');
	const cppBuildDir = join(repoRoot, 'packages', 'subtitle-ocr', 'subtitle-cpp', 'build');
	const ocrBinary = join(cppBuildDir, 'Release', isWindows ? 'ocr_pipeline.exe' : 'ocr_pipeline');

	// 若二进制已存在，跳过
	if (existsSync(ocrBinary)) {
		log('ocr_pipeline 已编译', 'gray');
		return;
	}

	// 下载 onnxruntime
	if (!existsSync(ortExtDir)) {
		log('下载 onnxruntime...', 'yellow');
		const tmpDir = join(repoRoot, 'packages', 'tmp');
		if (!existsSync(tmpDir)) {
			run(isWindows
				? ['cmd', '/c', 'mkdir', tmpDir]
				: ['mkdir', '-p', tmpDir],
				{ cwd: repoRoot });
		}

		const archivename = isWindows ? 'onnxruntime-win-x64-1.26.0.zip' : 'onnxruntime-linux-x64-1.24.4.tgz';
		const archivePath = join(tmpDir, archivename);
		const downloadUrl = isWindows
			? `https://github.com/microsoft/onnxruntime/releases/download/v1.26.0/${archivename}`
			: `https://github.com/microsoft/onnxruntime/releases/download/v1.24.4/${archivename}`;

		// 使用 curl 下载
		const curlCode = run(
			['curl', '-L', '-o', archivePath, downloadUrl],
			{ cwd: repoRoot }
		);
		if (curlCode !== 0) {
			log(`onnxruntime 下载失败 (curl exit ${curlCode})`, 'red');
			return;
		}

		// 解压
		log('解压 onnxruntime...', 'yellow');
		if (isWindows) {
			run(['powershell', '-Command', `Expand-Archive -Path "${archivePath}" -DestinationPath "${tmpDir}" -Force`], { cwd: repoRoot });
		} else {
			run(['tar', '-xzf', archivePath, '-C', tmpDir], { cwd: repoRoot });
		}
	} else {
		log('onnxruntime 已存在', 'gray');
	}

	// 检查 cmake
	if (!checkCommand('cmake')) {
		log('cmake 未找到，跳过 ocr_pipeline 编译', 'yellow');
		return;
	}

	// 添加 MSYS2 工具链到 PATH（cmake 需要用到 g++ 和 make）
	const msys2Paths = isWindows
		? 'C:\\msys64\\mingw64\\bin;C:\\msys64\\usr\\bin;'
		: '';
	const buildEnv: Record<string, string> = {
		...process.env,
		PATH: `${msys2Paths}${process.env.PATH}`,
	};

	// 编译
	log('编译 ocr_pipeline...', 'yellow');
	const cmakeOpts = isWindows
		? ['cmake', '-B', cppBuildDir, '-S', join(repoRoot, 'packages', 'subtitle-ocr', 'subtitle-cpp'),
			`-DORT_DIR=${ortExtDir}`, '-G', 'MinGW Makefiles']
		: ['cmake', '-B', cppBuildDir, '-S', join(repoRoot, 'packages', 'subtitle-ocr', 'subtitle-cpp'),
			`-DORT_DIR=${ortExtDir}`];

	const cmakeCode = run(cmakeOpts, { cwd: repoRoot, env: buildEnv });
	if (cmakeCode !== 0) {
		log(`cmake configure 失败 (exit ${cmakeCode})`, 'red');
		return;
	}

	const buildCode = run(
		['cmake', '--build', cppBuildDir, '--parallel'],
		{ cwd: repoRoot, env: buildEnv }
	);
	if (buildCode !== 0) {
		log(`ocr_pipeline 编译失败 (exit ${buildCode})`, 'red');
		return;
	}

	if (existsSync(ocrBinary)) {
		log('ocr_pipeline 编译成功', 'green');
	} else {
		log(`编译完成但 binary 未找到: ${ocrBinary}`, 'yellow');
	}
}

// ---------------------------------------------------------------------------
// 工作目录
// ---------------------------------------------------------------------------

function setupWorkdir(envWorkfolder?: string) {
	const workfolder = envWorkfolder ?? join(repoRoot, 'workfolder');
	// Use mkdir -p via spawn
	if (isWindows) {
		run(['cmd', '/c', 'mkdir', workfolder], { cwd: repoRoot });
	} else {
		run(['mkdir', '-p', workfolder], { cwd: repoRoot });
	}
	log(`工作目录: ${workfolder}`, 'green');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
	console.log('\n=== LocalDub 环境设置 ===\n');

	const args = process.argv.slice(2);
	const skipPipUpgrade = args.includes('--skip-pip-upgrade');
	const skipJs = args.includes('--skip-js');
	const skipOcr = args.includes('--skip-ocr');

	if (skipPipUpgrade) {
		log('将跳过 pip 升级', 'yellow');
	}

	checkPrerequisites();

	const gpuMode = detectGpu();
	log(`GPU 检测: ${gpuMode}`, 'cyan');

	// Read config.json
	const configPath = join(repoRoot, 'packages', 'cli', 'config.json');
	let config: CliConfig = {};
	if (existsSync(configPath)) {
		try {
			config = JSON.parse(readFileSync(configPath, 'utf-8'));
			log(`separate.runtime=${config.stages?.separate?.runtime}, tts.runtime=${config.stages?.tts?.runtime}`, 'cyan');
		} catch {
			log('config.json 解析失败', 'yellow');
		}
	} else {
		log('config.json not found, skipping submodule init', 'yellow');
	}

	checkEnv();

	const venv = join(repoRoot, '.venv');
	setupPython(venv, gpuMode, skipPipUpgrade);

	if (!skipJs) {
		const nodeModules = join(repoRoot, 'node_modules');
		setupJs(nodeModules);
	} else {
		log('跳过 JS 依赖安装', 'gray');
	}

	setupSubmodules(config, venv);

	if (!skipOcr) {
		setupOcrCpp();
	} else {
		log('跳过 OCR 编译', 'gray');
	}

	const envWorkfolder = process.env['WORKFOLDER'];
	setupWorkdir(envWorkfolder);

	console.log('\n=== 安装完成 ===');
	console.log('\n使用方式:');
	console.log('  编辑 .env 中的 API key 和配置');
	console.log('  编辑 packages/cli/config.json 中的任务配置');
	console.log('  运行: cd packages/cli && bun run run-task.ts');
	console.log('\n可选参数:');
	console.log('  --skip-pip-upgrade   跳过 pip 升级');
	console.log('  --skip-js            跳过 JS 依赖安装');
	console.log('  --skip-ocr           跳过 OCR binary 编译');
	console.log('');
}

main();
