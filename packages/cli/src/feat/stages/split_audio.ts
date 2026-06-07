import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readTaskLanguages, translationFilePath, ffmpeg, nowISO, updateStageDB } from './utils.ts';

export async function stageSplitAudio(taskId: string, sessionPath: string) {
  const vocalsFile = join(sessionPath, 'media', 'audio_vocals.wav');
  const { targetLanguage: dstLangCode } = readTaskLanguages(sessionPath);
  const translationFile = translationFilePath(sessionPath, dstLangCode);

  if (!existsSync(translationFile)) throw new Error(`${translationFile} not found`);

  const data = JSON.parse(readFileSync(translationFile, 'utf-8'));
  const segmentsDir = join(sessionPath, 'segments', 'vocals');
  mkdirSync(segmentsDir, { recursive: true });

  const anySeg = readdirSync(segmentsDir).find(f => f.endsWith('.wav'));
  if (anySeg && statSync(translationFile).mtimeMs > statSync(join(segmentsDir, anySeg)).mtimeMs) {
    for (const f of readdirSync(segmentsDir)) rmSync(join(segmentsDir, f));
  }

  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', vocalsFile], { stdio: ['pipe', 'pipe', 'pipe'] });
  const totalMs = Math.floor(parseFloat(probe.stdout.toString().trim()) * 1000) || 0;

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

  await updateStageDB(taskId, 'split_audio', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'Split' });
}
