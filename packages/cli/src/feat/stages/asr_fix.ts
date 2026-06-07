import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { nowISO, updateStageDB } from './utils.ts';

function fixAsrUtterances(utterances: any[], duration: number, startPad = 100, endPad = 300): any[] {
  if (!utterances.length) return utterances;
  const minGap = 50;

  const startPadAt = (idx: number): number => {
    const origStart = utterances[idx].start_time;
    if (idx === 0) return Math.max(0, origStart - startPad);
    const prevEnd = utterances[idx - 1].end_time;
    const gap = origStart - prevEnd;
    const total = startPad + endPad;
    if (gap >= total + minGap) return origStart - startPad;
    if (gap > minGap) {
      const share = Math.floor((gap - minGap) * startPad / total);
      return origStart - share;
    }
    return prevEnd + Math.floor(gap / 2);
  };

  const endPadAt = (idx: number): number => {
    const origEnd = utterances[idx].end_time;
    if (idx === utterances.length - 1) {
      return duration ? Math.min(duration, origEnd + endPad) : origEnd + endPad;
    }
    const nextStart = utterances[idx + 1].start_time;
    const gap = nextStart - origEnd;
    const total = startPad + endPad;
    if (gap >= total + minGap) return origEnd + endPad;
    if (gap > minGap) {
      const share = Math.floor((gap - minGap) * endPad / total);
      return origEnd + share;
    }
    return origEnd + Math.floor(gap / 2);
  };

  return utterances.map((u, idx) => {
    const newStart = startPadAt(idx);
    const newEnd = Math.min(duration, endPadAt(idx));
    return { ...u, start_time: Math.max(0, newStart), end_time: newEnd };
  });
}

export async function stageAsrFix(taskId: string, sessionPath: string) {
  const metadataDir = join(sessionPath, 'metadata');
  const asrFile = join(metadataDir, 'asr.json');
  const fixedFile = join(metadataDir, 'asr_fixed.json');

  if (existsSync(fixedFile) && existsSync(asrFile) && statSync(asrFile).mtimeMs <= statSync(fixedFile).mtimeMs) {
    await updateStageDB(taskId, 'asr_fix', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'Already fixed' });
    return;
  }

  const data = JSON.parse(readFileSync(asrFile, 'utf-8'));
  const utterances = data.result.utterances;
  const duration = data.audio_info?.duration ?? 0;

  const cleaned = utterances
    .map((u: any) => ({ text: (u.text || '').trim(), start_time: u.start_time, end_time: u.end_time }))
    .filter((u: any) => u.text);

  if (!cleaned.length) throw new Error('ASR result has no utterances.');

  const padded = fixAsrUtterances(cleaned, duration);
  writeFileSync(fixedFile, JSON.stringify({
    audio_info: data.audio_info || {},
    result: { text: data.result.text || '', utterances: padded },
  }, null, 2));

  await updateStageDB(taskId, 'asr_fix', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'Fixed' });
}
