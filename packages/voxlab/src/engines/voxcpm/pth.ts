import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { delimiter } from 'node:path';
import { readWav } from '../../wav.ts';
import type { TTSGenerateOptions, TTSGenerateResult, TTSBackend, VoxCPMPythonConfig, ModelStatus } from '../../types.ts';
import { VOXCPM_DIR, REPO_ROOT } from '@repo/config';

let _scriptPath: string | null = null;
function getScriptPath(): string {
  if (_scriptPath) return _scriptPath;
  _scriptPath = join(import.meta.dir, '..', '..', '..', 'scripts', 'voxcpm_infer.py');
  return _scriptPath;
}

export class VoxCPMPython implements TTSBackend {
  readonly name = 'python';
  private modelDir: string;
  private pythonBin: string;

  constructor(config: VoxCPMPythonConfig = {}) {
    this.modelDir = config.modelDir ?? VOXCPM_DIR;
    if (config.python) {
      this.pythonBin = config.python;
    } else {
      const isWin = process.platform === 'win32';
      this.pythonBin = join(REPO_ROOT, '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
    }
  }

  async load(): Promise<void> {
    if (!existsSync(this.modelDir)) {
      throw new Error(`VoxCPM model not found: ${this.modelDir}`);
    }
    if (!existsSync(getScriptPath())) {
      throw new Error(`Python inference script not found: ${getScriptPath()}`);
    }
  }

  async generate(options: TTSGenerateOptions): Promise<TTSGenerateResult> {
    const tmpDir = mkdtempSync(join(tmpdir(), 'voxlab-pth-'));
    const outPath = join(tmpDir, 'out.wav');

    return new Promise((resolve, reject) => {
      const voxcpmSrc = join(REPO_ROOT, 'submodule', 'VoxCPM', 'src');
      const proc = spawn(this.pythonBin, [
        getScriptPath(),
        '--model-dir', this.modelDir,
        '--ref', options.referenceWavPath,
        '--text', options.text,
        '--output', outPath,
        '--device', 'cpu',
      ], {
        env: { ...process.env, PYTHONPATH: voxcpmSrc },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python exit code ${code}: ${stderr.slice(-500)}`));
          return;
        }

        const meta: Record<string, number> = {};
        try {
          Object.assign(meta, JSON.parse(stdout.trim()));
        } catch {
          // meta JSON not critical
        }

        const loadTimeSec = meta.load_time_s ?? 0;
        const genTimeSec = meta.generate_time_s ?? 0;

        if (genTimeSec) {
          console.log(`[VoxCPM] Generated ${meta.output_samples} samples (${meta.output_duration_s}s) in ${genTimeSec}s | RTF ${meta.rtf}`);
        }

        if (!existsSync(outPath)) {
          reject(new Error('Python script did not produce output WAV'));
          return;
        }

        try {
          const { samples } = readWav(outPath);
          resolve({ samples, loadTimeSec, genTimeSec });
        } catch (err) {
          reject(err);
        }
      });

      proc.on('error', reject);
    });
  }

  async dispose(): Promise<void> {
    // no-op for subprocess-based backend
  }
}
