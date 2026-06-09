import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readTaskLanguages, translationFilePath, ffmpeg, nowISO, updateStageDB } from './utils.ts';
import { readConfig } from '../config/config.ts';
import { env } from '@repo/config';

function detectLeadingSilence(wavPath: string): number {
  const r = spawnSync(env.FFMPEG_PATH, [
    '-i', wavPath,
    '-af', 'silencedetect=noise=-25dB:d=0.3',
    '-f', 'null', '-',
  ], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 });
  if (r.status !== 0) return 0;
  const stderr = r.stderr.toString();
  const m = stderr.match(/silence_end:\s+([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

export async function stageSplitAudio(taskId: string, sessionPath: string) {
  const vocalsFile = join(sessionPath, 'media', 'target_3_vocals.wav');
  const { targetLanguage: dstLangCode } = readTaskLanguages(sessionPath);
  const translationFile = translationFilePath(sessionPath, dstLangCode);
  const metadataDir = join(sessionPath, 'metadata');
  const fixedFile = join(metadataDir, 'asr_fixed.json');

  if (!existsSync(translationFile)) throw new Error(`${translationFile} not found`);

  let totalMs = 0;
  try {
    const fix = JSON.parse(readFileSync(fixedFile, 'utf-8'));
    totalMs = fix.audio_info?.duration ?? 0;
  } catch { /* fallback below */ }
  if (!totalMs) {
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', vocalsFile], { stdio: ['pipe', 'pipe', 'pipe'] });
    totalMs = Math.floor(parseFloat(probe.stdout.toString().trim()) * 1000) || 0;
  }

  const data = JSON.parse(readFileSync(translationFile, 'utf-8'));
  const segmentsDir = join(sessionPath, 'segments', 'vocals');
  mkdirSync(segmentsDir, { recursive: true });

  const anySeg = readdirSync(segmentsDir).find(f => f.endsWith('.wav'));
  if (anySeg && statSync(translationFile).mtimeMs > statSync(join(segmentsDir, anySeg)).mtimeMs) {
    for (const f of readdirSync(segmentsDir)) rmSync(join(segmentsDir, f));
  }

  for (let i = 0; i < data.translation.length; i++) {
    const item = data.translation[i];
    const idx = String(i + 1).padStart(4, '0');
    const outPath = join(segmentsDir, `${idx}.wav`);
    if (existsSync(outPath)) continue;

    const start = Math.max(0, Math.floor(item.start_time) - 80);
    const end = Math.min(totalMs, Math.ceil(item.end_time) + 160);

    if (end <= start) {
      writeFileSync(outPath, Buffer.alloc(44));
      continue;
    }

    ffmpeg(['-i', vocalsFile, '-ss', String(start / 1000), '-to', String(end / 1000), '-c', 'copy', outPath]);
  }

  const splitCfg = readConfig().stages?.split_audio;
  if (splitCfg?.vadAlign) {
    let corrected = false;
    for (let i = 0; i < data.translation.length; i++) {
      const idx = String(i + 1).padStart(4, '0');
      const wavPath = join(segmentsDir, `${idx}.wav`);
      if (!existsSync(wavPath)) continue;

      const offset = detectLeadingSilence(wavPath);
      if (offset > 0.5) {
        const offsetMs = Math.round(offset * 1000);
        const newStart = Math.max(0, Math.floor(data.translation[i].start_time) + offsetMs - 80);
        const newEnd = Math.min(totalMs, Math.ceil(data.translation[i].end_time) + 160);
        if (newEnd > newStart) {
          ffmpeg(['-i', vocalsFile, '-ss', String(newStart / 1000), '-to', String(newEnd / 1000), '-c', 'copy', wavPath]);
          data.translation[i].start_time = newStart;
          corrected = true;
        }
      }
    }
    if (corrected) {
      writeFileSync(translationFile, JSON.stringify(data, null, 2));
    }
  }

  await updateStageDB(taskId, 'split_audio', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'Split' });
}
