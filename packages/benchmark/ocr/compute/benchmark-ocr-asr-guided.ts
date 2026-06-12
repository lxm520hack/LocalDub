// ASR-guided OCR benchmark (mid1fps strategy only)
// Usage: ASR_SOURCE=ggml-s1-vocals ASR_PARAM=baseline \
//   bun run benchmark-ocr-asr-guided.ts --text-score 0.45 --subtitle-only --label sep-vocals-asr-guided-ocr-so-ts0.45-mid1fps
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const CPP_BIN = resolve(REPO_ROOT, 'packages', 'ocr-cpp', 'build', 'ocr_pipeline');
const CPP_LD_PATH = resolve(REPO_ROOT, 'packages', 'ocr-cpp', 'build');
const VIDEO_PATH = resolve(REPO_ROOT, 'packages', 'benchmark', 'ref', 'media', 'video_source.mp4');
const ASR_SOURCE = process.env.ASR_SOURCE || 'ggml-s1-vocals';
const ASR_PARAM = process.env.ASR_PARAM || 'baseline';
const ASR_RAW = resolve(REPO_ROOT, 'packages', 'benchmark', 'asr', 'whisper', 'results', ASR_SOURCE, ASR_PARAM, 'metadata', 'whisper_raw.json');
const RESULTS_BASE = resolve(__dirname, '..', 'results');
const TMP_DIR = resolve(REPO_ROOT, 'packages', 'tmp', 'ocr-asr-guided');

interface Segment { text: string; start: number; end: number }
interface ASRSeg extends Segment { text: string }
interface OCRLine { text: string; confidence: number }

let TEXT_SCORE = 0.45;
let SUBTITLE_ONLY = true;
let LABEL = '';
let STRATEGY = 'mid1fps';

function parseArgs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--text-score') TEXT_SCORE = parseFloat(args[++i]);
    if (args[i] === '--subtitle-only') SUBTITLE_ONLY = true;
    if (args[i] === '--label') LABEL = args[++i];
    if (args[i] === '--strategy') STRATEGY = args[++i];
    if (args[i] === '--help') {
      console.log('Usage: ASR_SOURCE=... ASR_PARAM=... bun run benchmark-ocr-asr-guided.ts [--text-score 0.45] [--subtitle-only] [--strategy mid1fps|end1fps] [--label name]');
      process.exit(0);
    }
  }
  if (!LABEL) {
    const so = SUBTITLE_ONLY ? '-so' : '';
    const ts = TEXT_SCORE != null ? `-ts${String(TEXT_SCORE).replace('.', '')}` : '';
    LABEL = `asr-guided-${ASR_SOURCE}-${ASR_PARAM}${so}${ts}-${STRATEGY}`;
  }
}

function loadASR(): ASRSeg[] {
  const raw = JSON.parse(readFileSync(ASR_RAW, 'utf-8'));
  return raw.transcription.map((s: any) => ({
    text: s.text,
    start: s.offsets.from,
    end: s.offsets.to,
  }));
}

function ocrFrame(framePath: string): OCRLine[] {
  const args = [framePath];
  if (TEXT_SCORE != null) args.push(String(TEXT_SCORE));
  if (SUBTITLE_ONLY) args.push('--subtitle-only');
  const r = spawnSync(CPP_BIN, args, {
    timeout: 60_000,
    encoding: 'utf-8',
    env: { ...process.env, LD_LIBRARY_PATH: CPP_LD_PATH },
  });
  if (r.status !== 0) return [];
  try {
    const parsed = JSON.parse(r.stdout);
    const lines: OCRLine[] = [];
    for (const seg of parsed.segments || []) lines.push({ text: seg.text, confidence: seg.confidence });
    if (lines.length === 0 && parsed.text) lines.push({ text: parsed.text, confidence: 1 });
    return lines;
  } catch { return []; }
}

function mergeSegments(segs: Segment[], sameTextGapMs = 1000): Segment[] {
  const merged: Segment[] = [];
  for (const s of segs) {
    if (!s.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.text === s.text && s.start - last.end <= sameTextGapMs) {
      last.end = Math.max(last.end, s.end);
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

function segmentsToText(segs: Segment[]): string { return segs.map((s) => s.text).join(''); }

function formatTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const ml = ms % 1000;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ml.toString().padStart(3, '0')}`;
}

function extractFrame(videoPath: string, timeMs: number, outPath: string): boolean {
  const r = spawnSync('ffmpeg', ['-y', '-ss', String(timeMs / 1000), '-i', videoPath, '-frames:v', '1', '-qscale:v', '2', outPath],
    { timeout: 10_000, encoding: 'utf-8' });
  return r.status === 0;
}

function run(label: string, segs: Segment[], desc: string, asrSrc: ASRSeg[], ocrCallCount?: number, elapsedSec?: number) {
  const text = segmentsToText(segs);
  const resultDir = join(RESULTS_BASE, label);
  mkdirSync(resultDir, { recursive: true });
  mkdirSync(join(resultDir, 'metadata'), { recursive: true });

  const asrSrcPath = `packages/benchmark/asr/whisper/results/${ASR_SOURCE}/${ASR_PARAM}/metadata/whisper_raw.json`;

  // summary.json — lightweight bench stats
  writeFileSync(join(resultDir, 'metadata', 'summary.json'), JSON.stringify({ label, desc, segments: segs.length, hyp_chars: text.length, ocrCalls: ocrCallCount ?? 0, elapsedSec: elapsedSec ?? 0 }, null, 2));

  // ocr.json — for eval-asr.ts --ms
  writeFileSync(join(resultDir, 'metadata', 'ocr.json'), JSON.stringify({
    audio_info: { duration: segs.length > 0 ? segs[segs.length - 1].end : 0 },
    result: { text, segments: segs.map((s) => ({ text: s.text, start: s.start, end: s.end })) },
  }, null, 2));

  // asr_ocr.json — provenance + full segments
  writeFileSync(join(resultDir, 'metadata', 'asr_ocr.json'), JSON.stringify({
    _engine: 'asr_ocr', _strategy: STRATEGY,
    _asr: { engine: 'whisper.cpp', model: 'ggml-large-v3-turbo', device: 'Vulkan (RADV)', source: asrSrcPath },
    _ocr: { engine: 'cpp-ort', model: 'rapidocar (det+cls+rec)', device: 'CPU', textScore: TEXT_SCORE, subtitleOnly: SUBTITLE_ONLY },
    _fusion_params: { strategy: STRATEGY, ocrCalls: ocrCallCount ?? 0, elapsedSec: elapsedSec ? Math.round(elapsedSec * 10) / 10 : 0 },
    result: { text, segments: segs.map((s) => ({ text: s.text, start: s.start, end: s.end, start_fmt: formatTime(s.start), end_fmt: formatTime(s.end) })) },
  }, null, 2));

  console.log(`[${label}] ${desc}`);
  console.log(`  segs=${segs.length} hyp=${text.length} calls=${ocrCallCount} in ${elapsedSec?.toFixed(1)}s`);
}

if (require.main === module) {
  parseArgs();
  const asrSegs = loadASR();

  console.log(`=== ASR-Guided OCR: ${STRATEGY} ===`);
  console.log(`ASR source: ${ASR_SOURCE}/${ASR_PARAM} (${asrSegs.length} segments)`);
  console.log(`OCR: textScore=${TEXT_SCORE}, subtitleOnly=${SUBTITLE_ONLY}`);
  console.log(`Label: ${LABEL}`);
  console.log();

  mkdirSync(TMP_DIR, { recursive: true });

  const results: { text: string; start: number; end: number }[] = [];
  let ocrCount = 0;
  let ocrStart = Date.now();

  for (let i = 0; i < asrSegs.length; i++) {
    const asr = asrSegs[i];
    const frames: number[] = [];
    if (STRATEGY === 'end1fps') {
      for (let t = Math.round(asr.end) - 200; t >= asr.start; t -= 1000) frames.push(Math.round(t));
      frames.sort((a, b) => a - b);
    } else {
      const midMs = Math.round((asr.start + asr.end) / 2);
      for (let t = midMs; t <= asr.end; t += 1000) frames.push(Math.round(t));
      for (let t = midMs - 1000; t >= asr.start; t -= 1000) frames.push(Math.round(t));
      frames.sort((a, b) => a - b);
    }

    for (const frameMs of frames) {
      const framePath = join(TMP_DIR, `${STRATEGY}_${i.toString().padStart(4, '0')}_${frameMs}.jpg`);
      if (!extractFrame(VIDEO_PATH, frameMs, framePath)) continue;

      const lines = ocrFrame(framePath);
      ocrCount++;
      const best = lines.reduce((a, b) => a.confidence > b.confidence ? a : b, { text: '', confidence: 0 });
      const threshold = TEXT_SCORE ?? 0.3;
      if (best.text && best.confidence > threshold) {
        results.push({ text: best.text, start: asr.start, end: asr.end });
      }
    }
  }

  // Dedup consecutive same-text
  const deduped: { text: string; start: number; end: number }[] = [];
  for (const r of results) {
    const last = deduped[deduped.length - 1];
    if (last && last.text === r.text && r.start <= last.end + 1000) {
      last.start = Math.min(last.start, r.start);
      last.end = Math.max(last.end, r.end);
    } else {
      deduped.push({ text: r.text, start: r.start, end: r.end });
    }
  }

  const elapsed = (Date.now() - ocrStart) / 1000;
  const segs = mergeSegments(deduped, 1000);
  const hop = STRATEGY === 'end1fps' ? 'end-200ms 1fps clamped' : 'mid ±1fps clamped';
  run(LABEL, segs, `ASR ${hop} (${ocrCount} OCR calls, ${elapsed.toFixed(1)}s)`, asrSegs, ocrCount, elapsed);

  spawnSync('rm', ['-rf', TMP_DIR]);
  console.log(`\nResults: ${join(RESULTS_BASE, LABEL)}`);
  console.log(`Eval: bun run packages/benchmark/ref/compute/eval-asr.ts packages/benchmark/ocr/results/${LABEL}/metadata/ocr.json --label ${LABEL} --ms
  (or: --write to save ocr_summary.json)`);
}
