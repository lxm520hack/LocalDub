export interface TrackSegment {
  index: number;
  text: string;
  startMs: number;
  endMs: number;
}

export interface Track {
  id: string;
  label: string;
  segments: TrackSegment[];
  color?: string;
}

export const BASE_PX_PER_MS = 0.08;
export const DEFAULT_COLORS = ["#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#ef4444", "#ec4899"];

export function msToRuler(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function rulerInterval(pxPerMs: number) {
  const raw = 80 / pxPerMs;
  const steps = [500, 1000, 2000, 5000, 10000, 30000, 60000];
  return steps.find(s => s >= raw) ?? 60000;
}

export function trackColor(index: number, track: Track) {
  return track.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}
