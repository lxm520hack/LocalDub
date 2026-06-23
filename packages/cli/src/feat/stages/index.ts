import type { MLDaemon } from '../../ml/daemon/client.ts';
import { stageDownload } from './download.ts';
import { stageSeparate } from './separate/separate.ts';
import { stageSeparateAfter } from './separate_after.ts';
import { stageAsr } from './asr/asr.ts';
import { stageAsrFix } from './asr/asr_fix.ts';
import { stageOcr } from './ocr/ocr.ts';
import { stageOcrFix } from './ocr/ocr_fix.ts';
import { stageAsrOcrPre } from './asr_ocr/asr_ocr_pre.ts';
import { stageAsrOcr } from './asr_ocr/asr_ocr.ts';
import { stageAsrOcrFix } from './asr_ocr/asr_ocr_fix.ts';
import { stageTranslate } from './translate.ts';
import { stageSplitAudio } from './split_audio.ts';
import { stageTts } from './tts.ts';
import { stageMergeAudio } from './merge_audio.ts';
import { stageMergeVideo } from './merge_video.ts';
import { readTaskLanguages, subtitleFilePath } from './utils/utils.ts';
import { join } from 'node:path';
import { readCtx, Task } from '../context/context.ts';

export { stageDownload };
export { stageSeparate };
export { stageSeparateAfter };
export { stageAsr };
export { stageAsrFix };
export { stageOcr };
export { stageOcrFix };
export { stageAsrOcrPre };
export { stageAsrOcr };
export { stageAsrOcrFix };
export { stageTranslate };
export { stageSplitAudio };
export { stageTts };
export { stageMergeAudio };
export { stageMergeVideo };


export type StageHandler = (taskId: string, sessionPath: string, task: Task, daemon?: MLDaemon) => Promise<void>;

export const STAGE_HANDLERS: Record<string, StageHandler> = {
  download: async (id, sp, task) => {
    const ctx = readCtx(sp)
    return stageDownload(ctx)
  },
  separate: (id, sp, _task, d) => {
    const ctx = readCtx(sp)
    return stageSeparate(ctx, d)
  },
  separate_after: (id, sp) => {
    const ctx = readCtx(sp)
    return stageSeparateAfter(ctx)
  },
  asr: (id, sp, _task, d) => { 
    const ctx = readCtx(sp)
    return stageAsr(ctx, d)
  },
  asr_fix: (id, sp, _task) => {
    const ctx = readCtx(sp)
    return stageAsrFix(ctx)
  },
  ocr: (id, sp, _task) =>{
    const ctx = readCtx(sp)
    return stageOcr(ctx)
  },
  ocr_fix: (id, sp, _task) => {
    const ctx = readCtx(sp)
    return stageOcrFix(ctx)},
  asr_ocr_pre: (id, sp, _task) => {
    const ctx = readCtx(sp)
    return stageAsrOcrPre(ctx)
  },
  asr_ocr: (id, sp, _task) => {
    const ctx = readCtx(sp)
    return stageAsrOcr(ctx)
  },
  asr_ocr_fix: (id, sp) => {
    const ctx = readCtx(sp)
    return stageAsrOcrFix(ctx)
  },
  translate: (id, sp, _task) => {
    const ctx = readCtx(sp)
    return stageTranslate(ctx)},
  split_audio: (id, sp, _task) => {
    const ctx = readCtx(sp)
    return stageSplitAudio({
      ctx,
    })
  },
  tts: (id, sp, _task, d) => {
    const ctx = readCtx(sp)
    return stageTts(ctx, d)
  },
  merge_audio: (id, sp, _task) => {
    const ctx = readCtx(sp)
    return stageMergeAudio(ctx)
  },
  merge_video: (id, sp, _task) =>{ 
    const ctx = readCtx(sp)
    return stageMergeVideo(ctx)
  },
};
