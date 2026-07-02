import { readJson, writeJson, writeFile, ensureDir } from '@repo/core/utils/fileOps';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readTaskLanguages, ffmpeg, nowISO, probeSampleRate, probeDuration, split_audio_timings_filepath, timings_filepath } from '@repo/core/stages/utils/utils.ts';
import { Context, setStage, setTask } from '@repo/core/context/context.ts';

export async function stageMergeAudio(ctx: Context) {
  const taskId = ctx.task.id;
  const sessionPath = ctx.task.session_path
  const { targetLanguage: dstLangCode } = readTaskLanguages(ctx);
  const mergeAudioDir = join(sessionPath, 'merge_audio');
  const ttsDir = join(sessionPath, 'tts', 'wavs');
  const stretchedDir = join(mergeAudioDir, 'stretched');
  const silenceDir = join(mergeAudioDir, 'silences');

  ensureDir(stretchedDir, ctx);
  ensureDir(silenceDir, ctx);
  ensureDir(mergeAudioDir, ctx);

  const dubbingFile = join(mergeAudioDir, 'audio_dubbing.wav');
  const timingsFile = split_audio_timings_filepath(sessionPath);
  if (!existsSync(timingsFile)) throw new Error(`timings.json not found: ${timingsFile}`);

  const data = await readJson(timingsFile, ctx);
  const translation = data.translation;
  const ttsFiles = translation.map((_: any, i: number) => join(ttsDir, `${String(i + 1).padStart(4, '0')}.wav`));

  for (const f of ttsFiles) {
    if (!existsSync(f)) throw new Error(`Missing TTS segment: ${f}`);
  }

  const sampleRate = probeSampleRate(ttsFiles[0]);

  const segmentInputs: string[] = [];
  let lastEndMs = 0;
  let drift = 0;

  const maxSpeed = ctx.input?.stages?.merge_audio?.maxSpeed ?? 1.35;
  const maxAdvanceMs = ctx.input?.stages?.merge_audio?.maxAdvanceMs ?? 500;
  const maxDelayMs = ctx.input?.stages?.merge_audio?.maxDelayMs ?? 500;

  for (let i = 0; i < translation.length; i++) {
    const segment = translation[i];
    const ttsFile = ttsFiles[i];
    const idx = String(i + 1).padStart(4, '0');
    const stretchedFile = join(stretchedDir, `${idx}.wav`);

    // Probe original TTS duration
    const ttsSec = probeDuration(ttsFile);

    // Trim trailing silence only (areverse so internal pauses aren't mistaken for tail)
    const trimmedFile = join(stretchedDir, `${idx}_trimmed.wav`);
    ffmpeg(['-i', ttsFile, '-af',
      'areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_duration=0.05,areverse',
      trimmedFile]);

    const trimmedSec = probeDuration(trimmedFile);

    // Determine advance — conservative for segments that already fit
    const originalSlotBaseSec = (segment.end_time - segment.start_time) / 1000;
    let advanceMs = 0;
    if (trimmedSec <= originalSlotBaseSec) {
      const surplusNoAdvanceSec = drift + (originalSlotBaseSec - trimmedSec);
      if (surplusNoAdvanceSec < 0.5) {
        advanceMs = Math.min(
          Math.round((0.5 - surplusNoAdvanceSec) * 1000),
          Math.round(maxAdvanceMs * 0.2)
        );
      }
    } else {
      advanceMs = Math.min(maxAdvanceMs, Math.max(0, Math.round(drift * 1000)));
    }

    const realStartMs = Math.max(segment.start_time - advanceMs, lastEndMs, 0);
    advanceMs = Math.max(0, segment.start_time - realStartMs);
    const effectiveDrift = drift - advanceMs / 1000;

    // Determine delay — borrow time from the next segment's gap
    const nextStartMs = (i < translation.length - 1) ? translation[i + 1].start_time : segment.end_time;
    const gapMs = Math.max(0, nextStartMs - segment.end_time);
    const delayMs = Math.min(gapMs, maxDelayMs);

    if (realStartMs > lastEndMs) {
      const gapSec = (realStartMs - lastEndMs) / 1000;
      const silenceFile = join(silenceDir, `silence_${i}.wav`);
      ffmpeg(['-f', 'lavfi', '-i', `anullsrc=r=${sampleRate}:cl=mono`, '-t', String(gapSec), silenceFile]);
      segmentInputs.push(silenceFile);
    }

    const originalSlotSec = (segment.end_time + delayMs - realStartMs) / 1000;
    // floor at 50ms so speed calc never goes negative
    const slotSec = Math.max(0.05, originalSlotSec + effectiveDrift);

    let stretchedSec: number;
    let newDrift: number;
    let speed = 1.0;
    if (trimmedSec <= originalSlotSec) {
      stretchedSec = trimmedSec;
      ffmpeg(['-i', trimmedFile, '-c', 'copy', stretchedFile]);
    } else if (trimmedSec <= slotSec) {
      stretchedSec = trimmedSec;
      ffmpeg(['-i', trimmedFile, '-c', 'copy', stretchedFile]);
    } else {
      speed = Math.min(maxSpeed, trimmedSec / slotSec);
      stretchedSec = trimmedSec / speed;
      ffmpeg(['-i', trimmedFile, '-filter:a', `rubberband=tempo=${speed.toFixed(4)}`, stretchedFile]);
    }
    newDrift = originalSlotSec - stretchedSec;
    if (newDrift > maxAdvanceMs / 1000) newDrift = maxAdvanceMs / 1000;

    drift = newDrift;
    segmentInputs.push(stretchedFile);

    const realEndMs = Math.floor(realStartMs + stretchedSec * 1000);
    lastEndMs = realEndMs;

    segment.original_duration_ms = segment.end_time - segment.start_time;
    segment.drift_ms = Math.round(drift * 1000);
    segment.advance_ms = advanceMs;
    segment.delay_ms = delayMs;
    segment.actual_start_time = Math.floor(realStartMs);
    segment.actual_end_time = realEndMs;
    segment.tts_duration_ms = Math.round(ttsSec * 1000);
    segment.stretched_duration_ms = Math.round(stretchedSec * 1000);
    segment.stretch_ratio = parseFloat((trimmedSec <= slotSec ? 1.0 : speed).toFixed(4));
  }

  if (segmentInputs.length === 0) throw new Error('No audio segments to merge');

  const concatFile = join(mergeAudioDir, 'concat_list.txt');
  writeFile(concatFile, segmentInputs.map(f => `file '${f}'`).join('\n'), ctx);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', concatFile, '-acodec', 'pcm_s16le', '-ar', String(sampleRate), '-ac', '1', dubbingFile]);

  writeJson(timings_filepath(sessionPath), { translation }, ctx);
  await setStage(sessionPath, 'merge_audio', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'Merged' });
}
