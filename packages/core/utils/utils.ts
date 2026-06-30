import { spawnSync } from 'node:child_process';

/**
 * 探索视频持续时间, ms
 */
export function probeVideoDuration(videoPath: string): number {
  const r = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    videoPath,
  ], { timeout: 15_000, encoding: 'utf-8' });
  return Math.round(parseFloat(r.stdout?.trim() || '0') * 1000);
}