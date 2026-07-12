import { For } from "solid-js";

interface SubtitleSegment {
  index: number;
  text: string;
  translation?: string;
  startMs: number;
  endMs: number;
}

interface Props {
  segments: SubtitleSegment[];
  duration: number;
  currentTime: number;
  onSeek: (ms: number) => void;
}

function msToTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function Timeline(props: Props) {
  const pxPerMs = () => (props.duration > 0 ? 800 / props.duration : 1);

  return (
    <div class="flex flex-col h-full bg-muted/30 border-t select-none">
      {/* Time ruler */}
      <div class="h-5 relative border-b bg-muted/20 text-[10px] text-muted-foreground flex-shrink-0">
        <div style={{ width: `${props.duration * pxPerMs()}px`, "min-width": "100%" }} class="relative h-full">
          {Array.from({ length: Math.ceil(props.duration / 10000) + 1 }, (_, i) => (
            <div
              class="absolute top-0 h-full border-l border-muted-foreground/20 pl-0.5"
              style={{ left: `${i * 10000 * pxPerMs()}px` }}
            >
              {msToTime(i * 10000)}
            </div>
          ))}
        </div>
      </div>

      {/* Tracks */}
      <div class="flex-1 overflow-auto relative" style={{ "scroll-behavior": "smooth" }}>
        {/* Source track */}
        <div class="h-8 relative border-b bg-muted/10">
          <div style={{ width: `${props.duration * pxPerMs()}px`, "min-width": "100%" }} class="relative h-full">
            <For each={props.segments}>
              {(seg) => (
                <div
                  class="absolute top-0.5 h-6 rounded cursor-pointer truncate text-xs px-1 leading-6 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30"
                  style={{
                    left: `${seg.startMs * pxPerMs()}px`,
                    width: `${Math.max((seg.endMs - seg.startMs) * pxPerMs(), 4)}px`,
                  }}
                  onClick={() => props.onSeek(seg.startMs)}
                  title={seg.text}
                >
                  {seg.text}
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Translation track */}
        <div class="h-8 relative border-b bg-muted/10">
          <div style={{ width: `${props.duration * pxPerMs()}px`, "min-width": "100%" }} class="relative h-full">
            <For each={props.segments}>
              {(seg) => (
                <div
                  class="absolute top-0.5 h-6 rounded cursor-pointer truncate text-xs px-1 leading-6 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30"
                  style={{
                    left: `${seg.startMs * pxPerMs()}px`,
                    width: `${Math.max((seg.endMs - seg.startMs) * pxPerMs(), 4)}px`,
                  }}
                  onClick={() => props.onSeek(seg.startMs)}
                  title={seg.translation || seg.text}
                >
                  {seg.translation || seg.text}
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Playhead */}
        <div
          class="absolute top-0 w-0.5 bg-red-500 z-10 pointer-events-none"
          style={{
            left: `${props.currentTime * pxPerMs()}px`,
            height: "64px",
          }}
        />
      </div>

      {/* Time display */}
      <div class="h-5 flex items-center justify-center text-[10px] text-muted-foreground border-t bg-muted/20 flex-shrink-0">
        {msToTime(props.currentTime)} / {msToTime(props.duration)}
      </div>
    </div>
  );
}
