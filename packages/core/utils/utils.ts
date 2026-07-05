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

export function srtTime(ms: number): string {
	const h = Math.floor(ms / 3600000);
	const m = Math.floor((ms % 3600000) / 60000);
	const s = Math.floor((ms % 60000) / 1000);
	const ml = ms % 1000;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ml).padStart(3, '0')}`;
}
export function sanitizeText(value: string, fallback = 'untitled'): string {
	const cleaned = value
		.replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^[._]+|[._]+$/g, '');
	return cleaned.slice(0, 120) || fallback;
}

export function nowISO(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, '');
}
