export interface StageSpec {
  name: string
  label: string
}

export const DUB_STAGES: StageSpec[] = [
  { name: 'download', label: 'Download' },
  { name: 'separate', label: 'Demucs' },
  { name: 'asr', label: 'Whisper' },
  { name: 'asr_fix', label: 'Split sentences' },
  { name: 'translate', label: 'Translate' },
  { name: 'split_audio', label: 'Split audio' },
  { name: 'tts', label: 'VoxCPM' },
  { name: 'merge_audio', label: 'Merge audio' },
  { name: 'merge_video', label: 'Merge video' },
]

export const SUBTITLE_STAGES: StageSpec[] = [
  { name: 'download', label: 'Download' },
  { name: 'separate', label: 'Demucs' },
  { name: 'asr', label: 'Whisper' },
  { name: 'asr_fix', label: 'Split sentences' },
  { name: 'translate', label: 'Translate' },
  { name: 'merge_video', label: 'Merge video' },
]

export function getStages(mode?: string): StageSpec[] {
  if (mode === 'subtitle') return SUBTITLE_STAGES;
  return DUB_STAGES;
}

/** @deprecated Use DUB_STAGES or getStages(mode) */
export const STAGES = DUB_STAGES;

export const DUB_STAGE_NAMES = DUB_STAGES.map(s => s.name)
export const SUBTITLE_STAGE_NAMES = SUBTITLE_STAGES.map(s => s.name)
export const STAGE_NAMES = DUB_STAGE_NAMES
