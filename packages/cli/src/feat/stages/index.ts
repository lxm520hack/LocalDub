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
import { Context, readCtx, Task } from '@repo/core/context/context.ts';


export type StageHandler = (sp: string) => Promise<void>;

export const STAGE_HANDLERS: Record<string, StageHandler> = {
  separate: async (sp) => await stageSeparate(readCtx(sp)),
  separate_after: async (sp) => await stageSeparateAfter(readCtx(sp)),
  asr: async (sp) => await stageAsr(readCtx(sp)),
  asr_fix: async (sp) => await stageAsrFix(readCtx(sp)),
  ocr: async (sp) => await stageOcr(readCtx(sp)),
  ocr_fix: async (sp) => await stageOcrFix(readCtx(sp)),
  asr_ocr_pre: async (sp) => await stageAsrOcrPre(readCtx(sp)),
  asr_ocr: async (sp)=> await stageAsrOcr(readCtx(sp)),
  asr_ocr_fix: async (sp) => await stageAsrOcrFix(readCtx(sp)),
  translate: async (sp) => await stageTranslate(readCtx(sp)),
  split_audio: async (sp) => await stageSplitAudio(readCtx(sp)),
  tts: (sp) =>  stageTts(readCtx(sp)),
  merge_audio: async (sp) => await stageMergeAudio(readCtx(sp)),
  merge_video: async (sp) => await stageMergeVideo(readCtx(sp)),
};
