import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { emitLog, probeDuration, separateDir } from '../../../feat/stages/utils/utils';
import { setStage } from '../../../feat/context/context';
import { DemucsCliArgs } from './cli_types';
import { DEMUCS_MODEL_DIR } from '@repo/config/path/models';
import { REPO_ROOT } from '@repo/config/path/root';

function findLibtorchPath(): string | null {
	const buildDir = join(REPO_ROOT, 'target', 'release', 'build');
	if (!existsSync(buildDir)) return null;
	for (const dir of readdirSync(buildDir)) {
		if (!dir.startsWith('torch-sys-')) continue;
		const libDir = join(buildDir, dir, 'out', 'libtorch', 'libtorch', 'lib');
		if (existsSync(join(libDir, 'libtorch_cpu.so'))) return libDir;
	}
	return null;
}

export async function separateBurn({
  sessionPath,
  audioPath,
  device,
  backend,
}: DemucsCliArgs & {
  backend?: string,
}) {
	backend ??= device === 'cpu' ? 'tch' : 'wgpu';
	const binName = `demucs-burn-${backend}`;
	const binPath = join(REPO_ROOT, 'target', 'release', binName);
	const modelPath = join(DEMUCS_MODEL_DIR, 'htdemucs_ft.safetensors');

	if (!existsSync(binPath)) {
		throw new Error(
			`Burn binary not found at ${binPath}\n`
			+ `Build with: cd ${join(REPO_ROOT, 'packages/separate/demucs_burn')} && cargo build --release --bin ${binName}`,
		);
	}

	if (!existsSync(modelPath)) {
		throw new Error(
			`Model not cached at ${modelPath}\n`
			+ 'Run demucs-burn-wgpu first to download it.'
			+ ' The model will be downloaded automatically on first run.',
		);
	}

	if (!existsSync(audioPath)) {
		throw new Error('audio_source.wav not found');
	}

	const sepDir = separateDir(sessionPath);
	mkdirSync(sepDir, { recursive: true });

	emitLog(sessionPath, `[separate] runtime=${binName} device=${device} binary=${binPath}`);

	const env: Record<string, string> = { ...process.env } as Record<string, string>;
	if (backend === 'tch') {
		const libtorchLib = findLibtorchPath();
		if (!libtorchLib) {
			throw new Error('libtorch not found. Build tch binary first.');
		}
		env.LD_LIBRARY_PATH = [libtorchLib, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
	}

	const t0 = performance.now();
	await new Promise<void>((resolve, reject) => {
		const proc = spawn(binPath, [audioPath, sepDir], { env });
		let stderr = '';
		const hung = setTimeout(() => {
			proc.kill('SIGKILL');
			reject(new Error('Burn separate timed out after 600s'));
		}, 600_000);

		let lastPct = -1;
		proc.stdout?.on('data', (chunk: Buffer) => {
			const lines = chunk.toString().split('\n');
			for (const line of lines) {
				const m = line.match(/\((\s*\d+(?:\.\d+)?)%\)/);
				if (m) {
					const pct = Math.min(100, Math.max(0, Math.round(Number(m[1]))));
					if (pct === lastPct) continue;
					lastPct = pct;
					setStage(sessionPath, 'separate', {
						progress: pct,
						last_message: `Separating ${pct}%`,
					});
				}
			}
		});

		proc.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		proc.on('error', (e) => {
			clearTimeout(hung);
			reject(new Error(`Burn separate failed to spawn: ${e.message}`));
		});

		proc.on('close', (code) => {
			clearTimeout(hung);
			if (code === 0) resolve();
			else reject(new Error(`Burn separate failed (${code}): ${stderr.slice(-300)}`));
		});
	});
	const elapsedSec = (performance.now() - t0) / 1000;

	emitLog(sessionPath, `[Separate] Processed in ${elapsedSec.toFixed(1)}s`);

	const stemNames = ['drums', 'bass', 'other', 'vocals'] as const;
	for (const name of stemNames) {
		const p = join(sepDir, `target_${stemNames.indexOf(name)}_${name}.wav`);
		if (!existsSync(p)) {
			emitLog(sessionPath, `[Separate] WARN: ${p} not found`);
		}
	}

	const durationS = probeDuration(audioPath);
	if (durationS > 0) {
		emitLog(sessionPath, `[Separate] RTF ${(elapsedSec / durationS).toFixed(3)}`);
	}
}