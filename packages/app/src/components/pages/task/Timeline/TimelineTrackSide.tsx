import { For } from "solid-js";
import type { Track } from "./consts";

interface Props {
  ref: (el: HTMLDivElement) => void;
  tracks: Track[];
  trackColor: (index: number, track: Track) => string;
}

export function TimelineTrackSide(props: Props) {
  return (
    <div class="w-30 shrink-0 border-r flex flex-col">
      <div class="h-5 border-b bg-muted/20 shrink-0" />
      <div ref={props.ref} class="flex-1 overflow-hidden">
        <For each={props.tracks}>
          {(track, i) => (
            <div
              class="h-16 border-b flex items-center px-3 text-xs text-muted-foreground truncate"
              style={{ "border-left": `3px solid ${props.trackColor(i(), track)}` }}
            >
              {track.label}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
