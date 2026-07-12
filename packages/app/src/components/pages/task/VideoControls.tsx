import { createMemo } from "solid-js";
import { Play, Pause } from "lucide-solid";
import { srtTime } from "@repo/core/utils/utils";

interface Props {
  playing: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  onTogglePlay: () => void;
  onRateChange: (rate: number) => void;
}

function fmt(ms: number) {
  const totalCs = Math.floor(ms / 10);
  const cs = totalCs % 100;
  const s = Math.floor(totalCs / 100);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function VideoControls(props: Props) {
  return (
    <div class="flex items-center h-10 px-3 gap-3 bg-muted/20 border-t text-sm select-none">
      {/* Time on left */}
      <span class="text-xs text-muted-foreground w-24 tabular-nums">
        {srtTime(props.currentTime, '.')} / {srtTime(props.duration, '.')}
      </span>

      {/* Play button centered */}
      <div class="flex-1 flex justify-center">
        <button
          onClick={props.onTogglePlay}
          class="flex items-center justify-center w-8 h-8 rounded hover:bg-accent/50"
        >
          {props.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
      </div>

      {/* Speed on right */}
      <select
        value={props.playbackRate}
        onChange={(e) => props.onRateChange(Number(e.currentTarget.value))}
        class="bg-transparent text-xs text-muted-foreground border rounded px-1 py-0.5"
      >
        {rates.map((r) => (
          <option value={r} class="bg-background">{r}x</option>
        ))}
      </select>
    </div>
  );
}
