import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export interface OcrSegment {
    text: string;
    confidence: number;
    box: number[][];
}

export interface OcrResult {
    text: string;
    segments: OcrSegment[];
    det_inference_ms: number;
    postprocess_ms: number;
    rec_inference_ms: number;
    total_ms: number;
}

// Resolve the path to the Rust binary relative to this file.
// `bun run` or `node` should run directly against `release` builds.
function rustBinaryPath(): string {
    const here = dirname(__filename);
    const repoRoot = resolve(here, '..', '..', '..');
    const dir = join(repoRoot, 'packages', 'subtitle-rust');
    const binary = process.platform === 'win32' ? 'ocr_pipeline_rs.exe' : 'ocr_pipeline_rs';
    const candidates = [
        join(dir, 'target', 'release', binary),
        join(dir, 'target', 'debug', binary),
    ];
    for (const c of candidates) if (existsSync(c)) return c;
    // fallback hope it's on PATH
    return binary;
}

const DEFAULT_MODELS_DIR = resolve(
    __dirname,
    '..',
    '..',
    '..',
    '.venv',
    'lib',
    'python3.14',
    'site-packages',
    'rapidocr_onnxruntime',
    'models',
);

const DEFAULT_KEYS = resolve(__dirname, '..', '..', 'subtitle-ocr', 'ppocr_keys.json');

export function runOcrFrame(
    imagePath: string,
    opts?: {
        textScore?: number;
        subtitleOnly?: boolean;
        device?: string;
        modelsDir?: string;
        keysPath?: string;
    },
): OcrResult {
    const bin = rustBinaryPath();
    const args = [imagePath];
    if (opts?.textScore != null) args.push(String(opts.textScore));
    if (opts?.subtitleOnly) args.push('--subtitle-only');
    if (opts?.device && opts.device !== 'cpu') {
        args.push('--device', opts.device);
    }

    const env = {
        ...process.env,
        OCR_MODELS_DIR: opts?.modelsDir || process.env.OCR_MODELS_DIR || DEFAULT_MODELS_DIR,
        OCR_KEYS_PATH: opts?.keysPath || process.env.OCR_KEYS_PATH || DEFAULT_KEYS,
    };

    const r = spawnSync(bin, args, {
        timeout: 120_000,
        encoding: 'utf-8',
        env,
    });
    if (r.status !== 0) {
        throw new Error(
            `ocr_pipeline_rs failed (exit ${r.status}): ${(r.stderr || '').slice(-500)}`,
        );
    }
    // Some toolchains print warnings on stderr; stdout is always JSON.
    const parsed = JSON.parse(r.stdout);
    return parsed as OcrResult;
}

export function hasRustBinary(): boolean {
    const bin = rustBinaryPath();
    return existsSync(bin);
}
