import { For } from "solid-js";
import type { Track } from "./consts";

interface Props {
  ref: (el: HTMLDivElement) => void;
  tracks: Track[];
  totalPx: number;
  pxPerMs: number;
  onSeek: (ms: number) => void;
  trackColor: (index: number, track: Track) => string;
  onScroll: () => void;
}

export function TimelineTracks(props: Props) {
  return (
    <div ref={props.ref} class="flex-1 overflow-auto min-h-0" onScroll={props.onScroll}>
      <div class="relative" style={{ width: `${props.totalPx}px`, "min-width": "100%" }}>
        <For each={props.tracks}>
          {(track, i) => {
            const c = props.trackColor(i(), track);
            return (
              <div class="h-16 border-b relative">
                <For each={track.segments}>
                  {(seg) => (
                    <div
                      class="absolute top-1 h-12 rounded cursor-pointer truncate text-xs px-2 border flex items-center hover:opacity-80"
                      style={{
                        left: `${seg.startMs * props.pxPerMs}px`,
                        width: `${Math.max((seg.endMs - seg.startMs) * props.pxPerMs, 4)}px`,
                        background: `${c}33`,
                        "border-color": `${c}55`,
                      }}
                      onClick={() => props.onSeek(seg.startMs)}
                      title={seg.text}
                    >
                      {seg.text}
                    </div>
                  )}
                </For>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
