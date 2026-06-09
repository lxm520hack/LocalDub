import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RESULTS_DIR,
  VIDEO_PATH,
  REPO_ROOT,
  PYTHON_BIN,
  round,
  type BenchmarkResult,
} from './bench-shared';

const SCRIPT = join(REPO_ROOT, 'packages', 'cli', 'scripts', 'asr', 'whisper_cli.py');

function measureLoadTime(forceCpu = false): number {
  const args = [SCRIPT, '--benchmark-load'];
  if (forceCpu) args.push('--no-gpu');

  const t0 = performance.now();
  const result = spawnSync(PYTHON_BIN, args, { timeout: 120_000 });
  if (result.status !== 0) {
    console.error(`--benchmark-load failed: ${result.stderr?.toString().slice(-300)}`);
    return (performance.now() - t0) / 1000;
  }
  const stdout = result.stdout.toString();
  const m = stdout.match(/load_time=([\d.]+)s/);
  return m ? parseFloat(m[1]) : (performance.now() - t0) / 1000;
}

function parseTotalTime(stderr: string): number {
  const m = stderr.match(/whisper_print_timings:\s+total time\s+=\s+([\d.]+)\s+ms/);
  return m ? parseFloat(m[1]) / 1000 : 0;
}

export async function benchmarkWhisperCli(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  const configs = [
    { label: 'GPU (HIPBLAS)', device: 'gpu', forceCpu: false },
    { label: 'CPU (no-gpu)', device: 'cpu', forceCpu: true },
  ];

  for (const cfg of configs) {
    console.log(`[whisper-cli] ${cfg.label} — measuring load time...`);
    const loadTimeS = round(measureLoadTime(cfg.forceCpu), 3);
    console.log(`  Load: ${loadTimeS}s`);

    console.log(`[whisper-cli] ${cfg.label} — transcribing...`);
    const outDir = join(RESULTS_DIR, `wcli-${cfg.device}-${Date.now()}`);
    mkdirSync(outDir, { recursive: true });

    const procArgs = [SCRIPT, VIDEO_PATH, outDir, 'en'];
    if (cfg.forceCpu) procArgs.push('--no-gpu');

    const t1 = performance.now();
    const result = spawnSync(PYTHON_BIN, procArgs, { timeout: 600_000 });

    if (result.status !== 0) {
      console.error(`  Transcribe failed: ${result.stderr?.toString().slice(-300)}`);
      rmSync(outDir, { recursive: true, force: true });
      continue;
    }

    const totalTimeS = parseTotalTime(result.stderr.toString());
    const processTimeS = round(totalTimeS > 0 ? totalTimeS - loadTimeS : (performance.now() - t1) / 1000, 3);

    results.push({
      engine: 'whisper-cli',
      device: cfg.device,
      computeType: 'gguf-float16',
      audioDurationS: 170,
      loadTimeS,
      processTimeS,
      totalTimeS: round(loadTimeS + processTimeS, 3),
      rtf: round(processTimeS / 170, 3),
    });

    console.log(`  RTF: ${results[results.length - 1].rtf}`);

    rmSync(outDir, { recursive: true, force: true });
  }

  return results;
}


