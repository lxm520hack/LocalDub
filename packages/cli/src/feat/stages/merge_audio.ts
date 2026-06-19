import { readJson, writeJson, writeFile, ensureDir } from './utils/fileOps.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readTaskLanguages, ffmpeg, nowISO,  } from './utils/utils.ts';
import { Context, setStage, setTask } from '../context/context.ts';

export async function stageMergeAudio(ctx: Context) {
  const taskId = ctx.task.id;
  const sessionPath = ctx.task.session_path
  setTask(sessionPath, { current_stage: 'merge_audio' });
  const { targetLanguage: dstLangCode } = readTaskLanguages(ctx);
  const ttsDir = join(sessionPath, 'segments', 'tts');
  const tmpDir = join(sessionPath, 'tmp');
  const stretchedDir = join(sessionPath, 'segments', 'stretched');
  const metadataDir = join(sessionPath, 'metadata');

  ensureDir(tmpDir, ctx);
  ensureDir(stretchedDir, ctx);
  ensureDir(metadataDir, ctx);

  const dubbingFile = join(tmpDir, 'audio_dubbing.wav');
  const timingsFile = join(metadataDir, 'timings.json');
  if (!existsSync(timingsFile)) throw new Error(`timings.json not found: ${timingsFile}`);

  const data = await readJson(timingsFile, ctx);
  const translation = data.translation;
  const ttsFiles = translation.map((_: any, i: number) => join(ttsDir, `${String(i + 1).padStart(4, '0')}.wav`));

  for (const f of ttsFiles) {
    if (!existsSync(f)) throw new Error(`Missing TTS segment: ${f}`);
  }

  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', ttsFiles[0]], { stdio: ['pipe', 'pipe', 'pipe'] });
  const sampleRate = parseInt(probe.stdout.toString().trim()) || 48000;

  const segmentInputs: string[] = [];
  let lastEndMs = 0;
  let drift = 0;

  const maxSpeed = ctx.input?.stages?.merge_audio?.maxSpeed ?? 1.05;
  const maxAdvanceMs = ctx.input?.stages?.merge_audio?.maxAdvanceMs ?? 500;
  const maxDelayMs = ctx.input?.stages?.merge_audio?.maxDelayMs ?? 500;

  for (let i = 0; i < translation.length; i++) {
    const segment = translation[i];
    const ttsFile = ttsFiles[i];
    const idx = String(i + 1).padStart(4, '0');
    const stretchedFile = join(stretchedDir, `${idx}.wav`);

    // Probe original TTS duration
    const ttsDurProbe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ttsFile], { stdio: ['pipe', 'pipe', 'pipe'] });
    const ttsSec = parseFloat(ttsDurProbe.stdout.toString().trim()) || 0;

    // Trim trailing silence only (areverse so internal pauses aren't mistaken for tail)
    const trimmedFile = join(stretchedDir, `${idx}_trimmed.wav`);
    ffmpeg(['-i', ttsFile, '-af',
      'areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_duration=0.05,areverse',
      trimmedFile]);

    const durProbe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', trimmedFile], { stdio: ['pipe', 'pipe', 'pipe'] });
    const trimmedSec = parseFloat(durProbe.stdout.toString().trim()) || 0;

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
      const silenceFile = join(tmpDir, `silence_${i}.wav`);
      if (!existsSync(silenceFile)) {
        ffmpeg(['-f', 'lavfi', '-i', `anullsrc=r=${sampleRate}:cl=mono`, '-t', String(gapSec), silenceFile]);
      }
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

  const concatFile = join(tmpDir, 'concat_list.txt');
  writeFile(concatFile, segmentInputs.map(f => `file '${f}'`).join('\n'), ctx);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', concatFile, '-acodec', 'pcm_s16le', '-ar', String(sampleRate), '-ac', '1', dubbingFile]);

  writeJson(timingsFile, { translation }, ctx);
  await setStage(sessionPath, 'merge_audio', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'Merged' });
}
