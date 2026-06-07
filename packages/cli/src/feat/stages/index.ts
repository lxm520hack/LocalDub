import type { MLDaemon } from '../../ml/daemon/client.ts';
import { stageDownload } from './download.ts';
import { stageSeparate } from './separate.ts';
import { stageAsr } from './asr.ts';
import { stageAsrFix } from './asr_fix.ts';
import { stageTranslate } from './translate.ts';
import { stageSplitAudio } from './split_audio.ts';
import { stageTts } from './tts.ts';
import { stageMergeAudio } from './merge_audio.ts';
import { stageMergeVideo } from './merge_video.ts';

export { stageDownload };
export { stageSeparate };
export { stageAsr };
export { stageAsrFix };
export { stageTranslate };
export { stageSplitAudio };
export { stageTts };
export { stageMergeAudio };
export { stageMergeVideo };

export type StageHandler = (taskId: string, sessionPath: string, task: any, daemon?: MLDaemon) => Promise<void>;

export const STAGE_HANDLERS: Record<string, StageHandler> = {
  download: async (id, sp, task) => stageDownload(id, sp, task.url),
  separate: (id, sp, _task, d) => stageSeparate(id, sp, d),
  asr: (id, sp, _task, d) => stageAsr(id, sp, d),
  asr_fix: (id, sp, _task) => stageAsrFix(id, sp),
  translate: (id, sp, _task) => stageTranslate(id, sp),
  split_audio: (id, sp, _task) => stageSplitAudio(id, sp),
  tts: (id, sp, _task, d) => stageTts(id, sp, d),
  merge_audio: (id, sp, _task) => stageMergeAudio(id, sp),
  merge_video: (id, sp, _task) => stageMergeVideo(id, sp),
};
