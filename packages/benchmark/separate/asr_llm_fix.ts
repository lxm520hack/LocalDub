import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const RESULTS_DIR = join(__dirname, 'results');
const GROUND_TRUTH = resolve(REPO_ROOT, 'packages', 'benchmark', 'asr_manual.json');
const PYTHON_BIN = join(REPO_ROOT, '.venv', 'bin', 'python');
const WER_PY = join(__dirname, 'wer.py');

const API_BASE = 'http://localhost:11434/v1';
const MODEL = 'gemma4:31b-cloud';

function segmentsToPrompt(segments: any[]): string {
  const fullText = segments.map(s => s.text).join(' ');
  const lines = segments.map((s, i) => `${i + 1}: ${s.text}`).join('\n');
  return `全文上下文（参考用，每句以空格分隔）：\n${fullText}\n\n请修正以下条目（保持行号不变）：\n${lines}`;
}

function parseLines(input: string, expectedCount: number): string[] | null {
  const texts: string[] = [];
  const lines = input.trim().split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*\d+\s*[):.]\s*(.+)/);
    if (m) texts.push(m[1].trim());
  }
  if (texts.length !== expectedCount) return null;
  return texts;
}

const SYSTEM_PROMPT = `你是一个 ASR 纠错助手。修正中文转录文本中的错别字。

这是一部中国仙侠/修仙题材动画的对话转录：
- 角色名：叶白、慧天（王慧天）、夜白
- 修仙术语：灵石、灵根、剑仙、心性定力、剑道天赋、剑法、神识、灵气
- 常见错例："零食"→"灵石"，"修为尚寝"→"修为尚浅"，"拜剑师祖"→"拜见师祖"，"王会天"→"王慧天"，"资质尚承"→"资质上乘"

输入包含两部分：
1. "全文上下文" — 完整对话，帮助理解语境
2. "请修正以下条目" — 按行号列出的待修正文本

规则：
1. 先参考全文上下文理解语境，再逐条修正
2. 保持行号不变
3. 只修改文字错误，不改标点
4. 保持行数完全一致
5. 不要添加解释或额外内容
6. 没有错误的行保持原样`;


async function fixWithLLM(srt: string): Promise<string> {
  const resp = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: srt },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`LLM API ${resp.status}: ${err.slice(0, 200)}`);
  }

  const json = await resp.json();
  return (json.choices?.[0]?.message?.content || '').trim();
}

function computeWER(refFile: string, hypFile: string): { wer: number; cer: number } {
  const r = spawnSync(PYTHON_BIN, [WER_PY, refFile, hypFile], { timeout: 30_000 });
  if (r.status !== 0) throw new Error(`wer.py failed: ${r.stderr?.toString().slice(-200)}`);
  return JSON.parse(r.stdout.toString());
}

interface FileEntry { label: string; file: string }

const FILES: FileEntry[] = [
  { label: 'raw', file: 'wer-raw-video.json' },
  { label: 'ggml', file: 'wer-ggml-shifts1-16bit.json' },
  { label: 'ort', file: 'wer-ort-video.json' },
  { label: 'pytorch-s1', file: 'wer-pytorch-shifts1.json' },
  { label: 'pytorch-s3', file: 'wer-pytorch-shifts3.json' },
];

interface Result {
  label: string;
  cerBefore: number; cerAfter: number; werBefore: number; werAfter: number;
  segmentsBefore: number; segmentsAfter: number; fallback: boolean;
}

async function main() {
  mkdirSync(RESULTS_DIR, { recursive: true });

  if (!existsSync(GROUND_TRUTH)) {
    console.error('Ground truth not found');
    process.exit(1);
  }

  const results: Result[] = [];

  for (const { label, file } of FILES) {
    const filePath = join(RESULTS_DIR, file);
    if (!existsSync(filePath)) {
      console.warn(`  SKIP: ${file} not found`);
      continue;
    }

    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const segments: any[] = data.result?.segments || [];
    const text = data.result?.text || '';
    const promptInput = segmentsToPrompt(segments);

    console.log(`[${label}] ${segments.length} segs, sending context+lines (${promptInput.length} chars)...`);
    const t0 = performance.now();
    const fixed = await fixWithLLM(promptInput);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

    const fixedTexts = parseLines(fixed, segments.length);
    let resultSegments: any[];
    let resultText: string;
    let fallback = false;

    if (fixedTexts) {
      resultSegments = segments.map((s: any, i: number) => ({ ...s, text: fixedTexts[i] }));
      resultText = fixedTexts.join(' ');
      console.log(`  Done in ${elapsed}s, parsed ${fixedTexts.length} segs OK`);
    } else {
      resultSegments = segments;
      resultText = text;
      fallback = true;
      console.log(`  Done in ${elapsed}s, PARSE FAILED (${
        (fixed.match(/\n/g) || []).length + 1
      } lines), using original`);
    }

    const fixedFile = join(RESULTS_DIR, `wer-${label}-llm-fixed.json`);
    writeFileSync(fixedFile, JSON.stringify({
      audio_info: data.audio_info || {},
      result: { text: resultText, segments: resultSegments },
      _device: data._device || 'cpu',
      _llm_fixed: true,
    }, null, 2));

    const origResult = computeWER(GROUND_TRUTH, filePath);
    const fixedResult = computeWER(GROUND_TRUTH, fixedFile);
    results.push({
      label, fallback,
      cerBefore: origResult.cer, cerAfter: fixedResult.cer,
      werBefore: origResult.wer, werAfter: fixedResult.wer,
      segmentsBefore: segments.length, segmentsAfter: resultSegments.length,
    });
  }

  console.log('\n=== LLM ASR 纠错对比 (SRT 模式) ===');
  console.log('版本\t\tCER 前\tCER 后\t改善\tWER 前\tWER 后\t分段\tFallback');
  for (const r of results) {
    const cerImpr = ((r.cerBefore - r.cerAfter) / Math.max(r.cerBefore, 0.0001) * 100).toFixed(1);
    const werImpr = ((r.werBefore - r.werAfter) / Math.max(r.werBefore, 0.0001) * 100).toFixed(1);
    console.log(
      `${r.label.padEnd(16)}\t${(r.cerBefore * 100).toFixed(2)}%\t${(r.cerAfter * 100).toFixed(2)}%\t${cerImpr}%\t${(r.werBefore * 100).toFixed(2)}%\t${(r.werAfter * 100).toFixed(2)}%\t${r.segmentsAfter}\t${r.fallback ? '⚠' : '✓'}`,
    );
  }

  const summary = results.map(r => ({
    label: r.label, fallback: r.fallback,
    cerBefore: r.cerBefore, cerAfter: r.cerAfter,
    werBefore: r.werBefore, werAfter: r.werAfter,
  }));
  writeFileSync(join(RESULTS_DIR, 'llm-fix-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nSummary saved to results/llm-fix-summary.json');
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
