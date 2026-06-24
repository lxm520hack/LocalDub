import { readJson, writeJson, ensureDir } from '../utils/fileOps.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from '../../config/config.ts';
import { emitLog, nowISO, srtTime } from '../utils/utils.ts';
import { buildSystemPrompt, segmentsToPrompt, fixWithLLM, parseLines } from './llm.ts';
import { Context, setStage } from '../../context/context.ts';

export async function stageOcrFix(ctx: Context) {
    const taskId = ctx.task.id;
  const sessionPath = ctx.task.session_path
  const ocrDir = join(sessionPath, 'ocr');
  const ocrFixDir = join(sessionPath, 'ocr_fix');
  const ocrFile = join(ocrDir, 'ocr.json');
  const fixFile = join(ocrFixDir, 'ocr_fix.json');

  ensureDir(ocrFixDir, ctx);

  if (!existsSync(ocrFile)) {
    throw new Error(`OCR file not found: ${ocrFile}; run OCR stage first`);
  }

  const data = await readJson(ocrFile, ctx);
  let segments: any[] = (data.result?.segments || [])
    .map((s: any) => ({ text: (s.text || '').trim(), start: s.start, end: s.end }))
    .filter((s: any) => s.text);

  if (!segments.length) throw new Error('OCR result has no segments.');

  const cfg = readConfig().stages?.ocr_fix;
  const llmFix = cfg?.llmFix ?? false;

  emitLog(sessionPath, `[OCR Fix] ${segments.length} segs, llmFix=${llmFix}`);

  // LLM correction
  if (llmFix) {
    const llmModel = cfg?.llmModel || 'gemma4:31b-cloud';
    const llmApiBase = cfg?.llmApiBase || 'http://localhost:11434/v1';
    const domainHint = cfg?.domainHint;

    if (domainHint) emitLog(sessionPath, `[OCR Fix] domainHint: ${domainHint}`);

    await setStage(sessionPath, 'ocr_fix', {
      last_message: `LLM fixing ${segments.length} segments...`,
    });

    const prompt = segmentsToPrompt(segments);
    emitLog(sessionPath, `[OCR Fix] LLM fixing ${segments.length} segs (model=${llmModel})...`);

    const t0 = performance.now();
    const fixed = await fixWithLLM(prompt, { model: llmModel, apiBase: llmApiBase, domainHint });
    const elapsedSec = ((performance.now() - t0) / 1000).toFixed(1);

    const fixedTexts = parseLines(fixed, segments.length);
    if (fixedTexts) {
      segments = segments.map((s: any, i: number) => ({ ...s, text: fixedTexts[i] }));
      emitLog(sessionPath, `[OCR Fix] LLM fixed ${segments.length} segs in ${elapsedSec}s`);
    } else {
      emitLog(sessionPath, `[OCR Fix] LLM response parse failed, keeping original text`);
    }
  }

  segments = segments.map((s: any) => ({ ...s, start_fmt: srtTime(s.start), end_fmt: srtTime(s.end) }));
  const resultText = segments.map((s: any) => s.text).join(' ');
  writeJson(fixFile, {
    audio_info: data.audio_info || {},
    result: { text: resultText, segments },
    _llm_fixed: llmFix,
  }, ctx);

  emitLog(sessionPath, `[OCR Fix] Written ${segments.length} segs to ocr_fix.json`);

  await setStage(sessionPath, 'ocr_fix', {
    status: 'succeeded', completed_at: nowISO(), progress: 100,
    last_message: llmFix ? `LLM fixed ${segments.length} segs` : 'Fixed',
  });
}
