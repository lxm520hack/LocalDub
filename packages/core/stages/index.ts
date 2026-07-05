import { stageSeparate } from './separate';
import { stageSeparateAfter } from './separate_after';
import { stageAsr } from './asr/asr';
import { stageAsrFix } from './asr/asr_fix';
import { stageOcr } from './ocr/ocr';
import { stageOcrFix } from './ocr/ocr_fix';
import { stageAsrOcrPre } from './asr_ocr/asr_ocr_pre';
import { stageAsrOcr } from './asr_ocr/asr_ocr';
import { stageAsrOcrFix } from './asr_ocr/asr_ocr_fix';
import { stageTranslate } from './translate';
import { stageSplitAudio } from './split_audio';
import { stageTts } from './tts';
import { stageMergeAudio } from './merge_audio';
import { stageMergeVideo } from './merge_video';
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
