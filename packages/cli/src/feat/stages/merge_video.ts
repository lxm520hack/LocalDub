import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { nowISO, updateStageDB, updateTaskDB, srtTime, ffmpeg, readTaskLanguages, translationFilePath } from './utils.ts';

function writeSrt(translation: any[], dstLang: string, outputPath: string) {
  const CLOSING_QUOTES = new Set(['"', "'", '」', '』', '》', '）', '】', '\u201d', '\u2019', ']']);
  const PUNCTUATION = new Set(['，', ',', '；', ';', '：', ':', '。', '?', '？', '!', '！', '、']);
  const PROTECTED_PAIRS: Record<string, string> = { '《': '》', '（': '）', '【': '】', '「': '」', '『': '』' };

  function splitProtected(text: string): string[] {
    const segs: string[] = [];
    let buf: string[] = [], inside: string | null = null;
    for (const ch of text) {
      if (!inside && ch in PROTECTED_PAIRS) { inside = PROTECTED_PAIRS[ch]; buf.push(ch); continue; }
      if (inside && ch === inside) { inside = null; buf.push(ch); continue; }
      if (!inside && PUNCTUATION.has(ch)) { const s = buf.join('').trim(); if (s) segs.push(s); buf = []; continue; }
      buf.push(ch);
    }
    const tail = buf.join('').trim();
    if (tail) segs.push(tail);
    return segs;
  }

  function attachClosingQuotes(segs: string[]): string[] {
    const fixed: string[] = [];
    for (const s of segs) {
      if (s && CLOSING_QUOTES.has(s[0]) && fixed.length) {
        fixed[fixed.length - 1] = `${fixed[fixed.length - 1]}${s}`.trim();
      } else {
        fixed.push(s.trim());
      }
    }
    return fixed;
  }

  function mergeShort(segs: string[]): string[] {
    const merged: string[] = [];
    let i = 0;
    while (i < segs.length) {
      let cur = segs[i];
      if (cur.trim().length < 5 && i + 1 < segs.length) {
        segs[i + 1] = `${cur}${segs[i + 1]}`.trim();
        i++;
        continue;
      }
      merged.push(cur);
      i++;
    }
    return merged;
  }

  function stripTrailingPunct(segs: string[]): string[] {
    return segs.map(s => {
      const t = s.trim();
      if (!t) return '';
      if (t.endsWith('，') || t.endsWith(',') || t.endsWith('。')) return t.slice(0, -1);
      return t.replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
  }

  function splitSubtitle(text: string): string[] {
    if (!text.trim()) return [];
    const segs = stripTrailingPunct(mergeShort(attachClosingQuotes(splitProtected(text))));
    return segs.length ? segs : [text.trim()];
  }

  const lines: string[] = [];
  let idx = 1;
  for (const item of translation) {
    const start = Math.floor(item.actual_start_time ?? item.start_time);
    const end = Math.floor(item.actual_end_time ?? item.end_time);
    if (end <= start) continue;

    const text = (item.dst || item.zh || '').trim();
    const fragments = splitSubtitle(text);
    if (!fragments.length) continue;

    const totalDuration = end - start;
    const weights = fragments.map(f => Math.max(1, f.replace(/\s/g, '').length));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let cursor = start, allocated = 0;

    for (let f = 0; f < fragments.length; f++) {
      const share = f < fragments.length - 1
        ? Math.max(200, Math.min(Math.round(totalDuration * weights[f] / totalWeight), totalDuration - allocated - 100))
        : Math.max(100, totalDuration - allocated);
      lines.push(String(idx));
      lines.push(`${srtTime(cursor)} --> ${srtTime(cursor + share)}`);
      lines.push(fragments[f]);
      lines.push('');
      cursor += share;
      allocated += share;
      idx++;
    }
  }

  writeFileSync(outputPath, lines.join('\n'));
}

function dstLangFromTranslation(translation: any[]): string {
  return translation.find((t: any) => t.dst_lang)?.dst_lang || 'zh';
}

function probeStyle(videoFile: string, dstLang: string, overrides?: { fontSize?: number; marginV?: number; alignment?: number; outline?: number; shadow?: number }): string {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', videoFile], { stdio: ['pipe', 'pipe', 'pipe'] });
  const sizeStr = probe.stdout.toString().trim();
  const [wStr, hStr] = sizeStr.split(',');
  const width = parseInt(wStr), height = parseInt(hStr);
  const isPortrait = height > width;
  const fontSize = overrides?.fontSize ?? (isPortrait ? (dstLang === 'zh' ? 12 : 9) : (dstLang === 'zh' ? 24 : 18));
  const marginV = overrides?.marginV ?? (isPortrait ? 70 : 5);
  const alignment = overrides?.alignment ?? 2;
  const outline = overrides?.outline ?? 0;
  const shadow = overrides?.shadow ?? 1;
  const font = dstLang === 'zh' ? 'Noto Sans CJK SC' : 'Arial';
  return `FontName=${font},FontSize=${fontSize},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=${outline > 0 ? 1 : 0},Outline=${outline},Shadow=${shadow},Alignment=${alignment},MarginV=${marginV}`;
}

export async function stageMergeVideo(taskId: string, sessionPath: string) {
  const mediaDir = join(sessionPath, 'media');
  const tmpDir = join(sessionPath, 'tmp');
  const metadataDir = join(sessionPath, 'metadata');

  const videoFile = join(mediaDir, 'video_source.mp4');

  if (!existsSync(videoFile)) throw new Error('video_source.mp4 not found');

  let mode = 'dub';
  let stageOverrides: { fontSize?: number; marginV?: number; alignment?: number; outline?: number; shadow?: number } | undefined;
  try {
    const info = JSON.parse(readFileSync(join(sessionPath, 'metadata', 'local_info.json'), 'utf-8'));
    mode = info.mode || 'dub';
    stageOverrides = info.stages?.merge_video;
  } catch { /* use default */ }

  const finalVideo = join(mediaDir, mode === 'subtitle' ? 'video_final_subtitle.mp4' : 'video_final.mp4');

  if (mode === 'subtitle') {
    const { targetLanguage: dstLangCode } = readTaskLanguages(sessionPath);
    const translationFile = translationFilePath(sessionPath, dstLangCode);
    if (!existsSync(translationFile)) throw new Error(`translation.${dstLangCode}.json not found`);
    const data = JSON.parse(readFileSync(translationFile, 'utf-8'));
    const dstLang = dstLangFromTranslation(data.translation);
    const subPath = join(metadataDir, `subtitles.${dstLang}.srt`);
    writeSrt(data.translation, dstLang, subPath);
    const style = probeStyle(videoFile, dstLang, stageOverrides);
    const escapedSub = subPath.replace(/'/g, "'\\\\''").replace(/'/g, "'\\''");

    ffmpeg(['-i', videoFile,
      '-vf', `subtitles='${escapedSub}':force_style='${style}'`,
      '-map', '0:v:0', '-map', '0:a:0',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'copy', '-movflags', '+faststart',
      finalVideo], 300_000);
  } else {
    const dubbingFile = join(tmpDir, 'audio_dubbing.wav');
    const bgmFile = join(mediaDir, 'audio_bgm.wav');
    const timingsFile = join(metadataDir, 'timings.json');

    if (!existsSync(dubbingFile)) throw new Error('audio_dubbing.wav not found');
    if (!existsSync(timingsFile)) throw new Error('timings.json not found');

    const data = JSON.parse(readFileSync(timingsFile, 'utf-8'));
    const dstLang = dstLangFromTranslation(data.translation);
    const subPath = join(metadataDir, `subtitles.${dstLang}.srt`);
    writeSrt(data.translation, dstLang, subPath);
    const style = probeStyle(videoFile, dstLang, stageOverrides);
    const escapedSub = subPath.replace(/'/g, "'\\\\''").replace(/'/g, "'\\''");

    const mixedAudio = join(tmpDir, 'audio_mixed.m4a');
    ffmpeg(['-i', dubbingFile, '-i', bgmFile, '-filter_complex',
      '[0:a]volume=1.0[a0];[1:a]volume=0.30[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0[aout]',
      '-map', '[aout]', '-c:a', 'aac', mixedAudio]);

    ffmpeg(['-i', videoFile, '-i', mixedAudio,
      '-vf', `subtitles='${escapedSub}':force_style='${style}'`,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-c:a', 'aac', '-movflags', '+faststart', '-shortest',
      finalVideo], 300_000);
  }

  await updateStageDB(taskId, 'merge_video', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'Merged' });

  const finalPath = `/api/video/${taskId}`;
  await updateTaskDB(taskId, { final_video_path: finalPath });
}
