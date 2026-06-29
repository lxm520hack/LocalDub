import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '@repo/config';
import {
  DEMUCS_MODEL_DIR,
  WHISPER_MODEL_DIR,
  VOXCPM_MODEL_DIR,
} from '@repo/config/path/models';
import type { CheckResult } from './types';

function tryExec(cmd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    const r = spawnSync(cmd, args, { timeout: 10_000, encoding: 'utf-8' } as any);
    return {
      ok: r.status === 0,
      stdout: ((r.stdout as string) || '').trim(),
      stderr: ((r.stderr as string) || '').trim(),
    };
  } catch {
    return { ok: false, stdout: '', stderr: '' };
  }
}

function fileSize(path: string): number | null {
  try {
    const s = statSync(path);
    return s.size;
  } catch {
    return null;
  }
}

function fmtSize(bytes: number): string {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  if (bytes > 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

async function checkModel(path: string, key: string, label: string, minMB: number): Promise<CheckResult> {
  const size = fileSize(path);
  if (size === null) return { key, status: 'fail', message: `${label} not found`, detail: path, required: false };
  const mb = size / 1e6;
  if (mb < minMB) return { key, status: 'warn', message: `${label} ${fmtSize(size)} (too small, expected >= ${minMB} MB)`, detail: path, required: false };
  return { key, status: 'pass', message: `${label} ${fmtSize(size)}`, detail: path, required: false };
}

export async function checkBun(): Promise<CheckResult> {
  const r = tryExec('bun', ['--version']);
  if (!r.ok) return { key: 'bun', status: 'fail', message: 'bun not found', required: true, hint: 'Install: curl -fsSL https://bun.sh/install | bash' };
  return { key: 'bun', status: 'pass', message: `bun ${r.stdout}`, required: true };
}

export async function checkPython(): Promise<CheckResult> {
  const pyBin = join(REPO_ROOT, '.venv', 'bin', 'python');
  if (!existsSync(pyBin)) return { key: 'python', status: 'fail', message: '.venv/bin/python not found', required: true, hint: 'Run: uv venv .venv && uv pip install .[demucs,voxcpm]' };
  const r = tryExec(pyBin, ['--version']);
  const ver = r.stdout.match(/(\d+\.\d+\.\d+)/)?.[0] || r.stdout;
  if (!r.ok) return { key: 'python', status: 'fail', message: 'python failed to run', required: true };
  return { key: 'python', status: 'pass', message: `Python ${ver}`, detail: pyBin, required: true };
}

export async function checkUv(): Promise<CheckResult> {
  const r = tryExec('uv', ['--version']);
  if (!r.ok) return { key: 'uv', status: 'fail', message: 'uv not found', required: true, hint: 'Install: curl -LsSf https://astral.sh/uv/install.sh | sh' };
  return { key: 'uv', status: 'pass', message: `uv ${r.stdout.split(' ')[1] || r.stdout}`, required: true };
}

export async function checkFfmpeg(): Promise<CheckResult> {
  const bin = process.env.FFMPEG_PATH || 'ffmpeg';
  const r = tryExec(bin, ['-version']);
  if (!r.ok) return { key: 'ffmpeg', status: 'fail', message: 'ffmpeg not found', required: true, hint: 'Install: sudo apt install ffmpeg / brew install ffmpeg / winget install Gyan.FFmpeg' };
  const ver = r.stdout.match(/ffmpeg version (\S+)/)?.[1] || '';
  const hasX264 = r.stdout.includes('libx264');
  const hasMp3 = r.stdout.includes('libmp3lame');
  const codecs = [hasX264 && 'libx264', hasMp3 && 'libmp3lame'].filter(Boolean).join(', ');
  return { key: 'ffmpeg', status: 'pass', message: `ffmpeg ${ver}${codecs ? ` (${codecs})` : ''}`, detail: bin, required: true };
}

export async function checkCargo(): Promise<CheckResult> {
  const r = tryExec('cargo', ['--version']);
  if (!r.ok) return { key: 'cargo', status: 'fail', message: 'cargo not found', required: false, hint: 'Install: rustup.rs or sudo apt install rustc cargo' };
  return { key: 'cargo', status: 'pass', message: `cargo ${r.stdout.match(/\d+\.\d+\.\d+/)?.[0] || r.stdout}`, required: false };
}

export async function checkVcpkg(): Promise<CheckResult> {
  if (process.platform !== 'win32') return { key: 'vcpkg', status: 'skip', message: 'only needed on Windows', required: false };
  const r = tryExec('vcpkg', ['--version']);
  if (!r.ok) return { key: 'vcpkg', status: 'fail', message: 'vcpkg not found', required: false, hint: 'git clone https://github.com/Microsoft/vcpkg && cd vcpkg && bootstrap-vcpkg.bat' };
  return { key: 'vcpkg', status: 'pass', message: 'vcpkg installed', required: false };
}

export async function checkVulkan(): Promise<CheckResult> {
  const r = tryExec('vulkaninfo', ['--summary']);
  if (!r.ok) return { key: 'vulkan', status: 'fail', message: 'vulkaninfo not available', required: false, hint: 'Install Vulkan drivers: sudo apt install mesa-vulkan-drivers vulkan-tools' };
  const line = r.stdout.split('\n').find((l: string) => l.includes('GPU') || l.includes('deviceName'));
  const gpu = line?.split(':').pop()?.trim() || '';
  return { key: 'vulkan', status: 'pass', message: `Vulkan available${gpu ? ` (${gpu})` : ''}`, required: false };
}

export async function checkRocm(): Promise<CheckResult> {
  const r = tryExec('rocm-smi', []);
  if (!r.ok) return { key: 'rocm', status: 'fail', message: 'rocm-smi not available', required: false, hint: 'Install ROCm: https://rocm.docs.amd.com' };
  return { key: 'rocm', status: 'pass', message: 'ROCm available', required: false };
}

export async function checkCuda(): Promise<CheckResult> {
  const r = tryExec('nvidia-smi', []);
  if (!r.ok) return { key: 'cuda', status: 'fail', message: 'nvidia-smi not available', required: false, hint: 'Install NVIDIA drivers + CUDA toolkit' };
  const ver = r.stdout.match(/CUDA Version:\s+(\S+)/)?.[1];
  return { key: 'cuda', status: 'pass', message: `CUDA${ver ? ` ${ver}` : ''} available`, required: false };
}

export async function checkLibtorch(): Promise<CheckResult> {
  const buildDir = join(REPO_ROOT, 'target', 'release', 'build');
  if (!existsSync(buildDir)) return { key: 'libtorch', status: 'fail', message: 'libtorch not found', required: false, hint: 'Build tch backend: cargo build --release -p demucs-burn-tch' };
  const dirs = readdirSync(buildDir).filter((d: string) => d.startsWith('torch-sys-'));
  if (dirs.length === 0) return { key: 'libtorch', status: 'fail', message: 'torch-sys build not found', required: false, hint: 'Build tch backend first' };
  const libDir = join(buildDir, dirs[0], 'out', 'libtorch', 'libtorch', 'lib');
  const soPath = join(libDir, 'libtorch_cpu.so');
  if (!existsSync(soPath)) return { key: 'libtorch', status: 'fail', message: 'libtorch_cpu.so not found', required: false, hint: 'tch build may be incomplete' };
  return { key: 'libtorch', status: 'pass', message: 'libtorch available', detail: libDir, required: false };
}

export async function checkWhisperGgml(): Promise<CheckResult> {
  return checkModel(join(WHISPER_MODEL_DIR, 'ggml-large-v3-turbo.bin'), 'whisper_ggml', 'whisper GGML', 1500);
}

export async function checkWhisperVad(): Promise<CheckResult> {
  return checkModel(join(WHISPER_MODEL_DIR, 'ggml-silero-v6.2.0.bin'), 'whisper_vad', 'VAD model', 0.5);
}

export async function checkWhisperSherpa(): Promise<CheckResult> {
  const dir = join(WHISPER_MODEL_DIR, 'sherpa_onnx');
  const encoder = join(dir, 'turbo-encoder.int8.onnx');
  const decoder = join(dir, 'turbo-decoder.int8.onnx');
  const tokens = join(dir, 'turbo-tokens.txt');
  const all = [encoder, decoder, tokens].every(f => existsSync(f));
  if (!all) return { key: 'whisper_sherpa', status: 'fail', message: 'sherpa-onnx model incomplete', detail: dir, required: false };
  return { key: 'whisper_sherpa', status: 'pass', message: 'sherpa-onnx model ready', detail: dir, required: false };
}

export async function checkWhisperOnnx(): Promise<CheckResult> {
  return checkModel(join(WHISPER_MODEL_DIR, 'encoder_model.onnx'), 'whisper_onnx', 'whisper ONNX', 200);
}

export async function checkDemucsPth(): Promise<CheckResult> {
  return checkModel(join(DEMUCS_MODEL_DIR, 'htdemucs_ft.safetensors'), 'demucs_pth', 'demucs safetensors', 300);
}

export async function checkDemucsOnnx(): Promise<CheckResult> {
  const stems = ['drums', 'bass', 'other', 'vocals'];
  const missing: string[] = [];
  for (const s of stems) {
    const p = join(DEMUCS_MODEL_DIR, `htdemucs_ft_${s}_fp16weights.onnx`);
    if (!existsSync(p)) missing.push(s);
  }
  const total = stems.length - missing.length;
  if (missing.length > 0) {
    const status: CheckResult['status'] = missing.length === stems.length ? 'fail' : 'warn';
    return { key: 'demucs_onnx', status, message: `${total}/${stems.length} stems (missing: ${missing.join(', ')})`, detail: DEMUCS_MODEL_DIR, required: false };
  }
  return { key: 'demucs_onnx', status: 'pass', message: `${total}/${stems.length} stems`, detail: DEMUCS_MODEL_DIR, required: false };
}

export async function checkVoxcpm2Pth(): Promise<CheckResult> {
  const model = join(VOXCPM_MODEL_DIR, 'model.safetensors');
  const vae = join(VOXCPM_MODEL_DIR, 'audiovae.pth');
  const modelOk = fileSize(model);
  const vaeOk = fileSize(vae);
  if (!modelOk || !vaeOk) {
    const missing = [!modelOk && 'model.safetensors', !vaeOk && 'audiovae.pth'].filter(Boolean).join(', ');
    return { key: 'voxcpm2_pth', status: 'fail', message: `VoxCPM2 incomplete: ${missing}`, detail: VOXCPM_MODEL_DIR, required: false, hint: 'Download: snapshot_download("OpenBMB/VoxCPM2", local_dir="data/models/voxcpm2")' };
  }
  return { key: 'voxcpm2_pth', status: 'pass', message: `VoxCPM2 (${fmtSize(modelOk)} + ${fmtSize(vaeOk)})`, detail: VOXCPM_MODEL_DIR, required: false };
}

export async function checkDotenv(): Promise<CheckResult> {
  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return { key: 'dotenv', status: 'fail', message: '.env not found', required: false, hint: 'Copy .env.example to .env and edit' };
  const content = readFileSync(envPath, 'utf-8');
  const hasDevice = content.includes('DEVICE=');
  const hasKey = content.includes('OPENAI_API_KEY=');
  const issues: string[] = [];
  if (!hasDevice) issues.push('DEVICE not set');
  if (!hasKey) issues.push('OPENAI_API_KEY not set');
  if (issues.length > 0) return { key: 'dotenv', status: 'warn', message: `.env loaded but ${issues.join(', ')}`, required: false };
  return { key: 'dotenv', status: 'pass', message: '.env loaded', required: false };
}

export const allChecks: Record<string, () => Promise<CheckResult>> = {
  bun: checkBun,
  python: checkPython,
  uv: checkUv,
  ffmpeg: checkFfmpeg,
  cargo: checkCargo,
  vcpkg: checkVcpkg,
  vulkan: checkVulkan,
  rocm: checkRocm,
  cuda: checkCuda,
  libtorch: checkLibtorch,
  whisper_ggml: checkWhisperGgml,
  whisper_vad: checkWhisperVad,
  whisper_sherpa: checkWhisperSherpa,
  whisper_onnx: checkWhisperOnnx,
  demucs_pth: checkDemucsPth,
  demucs_onnx: checkDemucsOnnx,
  voxcpm2_pth: checkVoxcpm2Pth,
  dotenv: checkDotenv,
};

export const ensureFns: Record<string, () => Promise<CheckResult>> = {
  dotenv: async () => {
    const src = join(REPO_ROOT, '.env.example');
    const dst = join(REPO_ROOT, '.env');
    if (existsSync(dst)) return { key: 'dotenv', status: 'pass', message: '.env already exists', required: false };
    if (!existsSync(src)) return { key: 'dotenv', status: 'fail', message: '.env.example not found', required: false };
    copyFileSync(src, dst);
    return { key: 'dotenv', status: 'pass', message: 'Created .env from .env.example', required: false, hint: 'Edit .env with your keys' };
  },
};
