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
import { Context, readCtx, Task } from '../context/context.ts';


export type StageHandler = (sp: string) => Promise<void>;

export const STAGE_HANDLERS: Record<string, StageHandler> = {
  separate: (sp) => stageSeparate(readCtx(sp)),
  separate_after: (sp) => stageSeparateAfter(readCtx(sp)),
  asr: (sp) => stageAsr(readCtx(sp)),
  asr_fix: (sp) => stageAsrFix(readCtx(sp)),
  ocr: (sp) => stageOcr(readCtx(sp)),
  ocr_fix: (sp) => stageOcrFix(readCtx(sp)),
  asr_ocr_pre: (sp) => stageAsrOcrPre(readCtx(sp)),
  asr_ocr: (sp)=> stageAsrOcr(readCtx(sp)),
  asr_ocr_fix: (sp) => stageAsrOcrFix(readCtx(sp)),
  translate: (sp) =>  stageTranslate(readCtx(sp)),
  split_audio: (sp) => stageSplitAudio(readCtx(sp)),
  tts: (sp) =>  stageTts(readCtx(sp)),
  merge_audio: (sp) => stageMergeAudio(readCtx(sp)),
  merge_video: (sp) => stageMergeVideo(readCtx(sp)),
};
