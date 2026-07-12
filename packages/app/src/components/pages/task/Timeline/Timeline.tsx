import { createSignal, For } from "solid-js";
import { ZoomIn, ZoomOut } from "lucide-solid";
import { useScrollSync } from "#/hooks/useScrollSync";

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

interface Props {
  tracks: Track[];
  duration: number;
  currentTime: number;
  onSeek: (ms: number) => void;
}

const BASE_PX_PER_MS = 0.08;
const DEFAULT_COLORS = ["#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#ef4444", "#ec4899"];

function msToRuler(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Timeline(props: Props) {
  const [zoom, setZoom] = createSignal(1);
  const pxPerMs = () => BASE_PX_PER_MS * zoom();
  const totalPx = () => props.duration * pxPerMs();

  const rulerInterval = () => {
    const raw = 80 / pxPerMs();
    const steps = [500, 1000, 2000, 5000, 10000, 30000, 60000];
    return steps.find(s => s >= raw) ?? 60000;
  };

  let tracksRef!: HTMLDivElement;
  let rulerRef!: HTMLDivElement;
  let labelsRef!: HTMLDivElement;

  const [scrollLeft, setScrollLeft] = createSignal(0);

  const handleTrackScroll = () => {
    setScrollLeft(tracksRef?.scrollLeft ?? 0);
  };

  let rightRef!: HTMLDivElement;
  let playheadDragging = false;

  const onPlayheadDown = (e: PointerEvent) => {
    e.preventDefault();
    playheadDragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPlayheadMove = (e: PointerEvent) => {
    if (!playheadDragging) return;
    const rect = rightRef.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollLeft();
    const ms = x / pxPerMs();
    props.onSeek(Math.max(0, Math.min(ms, props.duration)));
  };

  const onPlayheadUp = () => {
    playheadDragging = false;
  };

  const onRulerClick = (e: MouseEvent) => {
    const rect = rulerRef.getBoundingClientRect();
    const x = e.clientX - rect.left + rulerRef.scrollLeft;
    const ms = x / pxPerMs();
    props.onSeek(Math.max(0, Math.min(ms, props.duration)));
  };

  useScrollSync(
    () => tracksRef,
    () => rulerRef,
    () => labelsRef,
  );

  const playheadLeft = () => props.currentTime * pxPerMs() - scrollLeft();

  const trackColor = (index: number, track: Track) =>
    track.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length];

  return (
    <div class="flex flex-col h-full bg-muted/30 border-t select-none">
      {/* Toolbar: zoom */}
      <div class="flex items-center h-7 px-2 gap-2 border-b bg-muted/20 shrink-0">
        <button onClick={() => setZoom(z => Math.max(0.25, z / 1.5))} class="hover:text-foreground text-muted-foreground">
          <ZoomOut size={14} />
        </button>
        <input
          type="range"
          min={0.25}
          max={8}
          step={0.05}
          value={zoom()}
          onInput={(e) => setZoom(Number(e.currentTarget.value))}
          class="w-20 h-1"
        />
        <button onClick={() => setZoom(z => Math.min(8, z * 1.5))} class="hover:text-foreground text-muted-foreground">
          <ZoomIn size={14} />
        </button>
        <span class="text-[10px] text-muted-foreground">{zoom().toFixed(1)}x</span>
      </div>

      {/* Main area: labels + content */}
      <div class="flex flex-1 overflow-hidden">
        {/* Left: Track labels (fixed width, scrollTop synced) */}
        <div class="w-30 shrink-0 border-r flex flex-col">
          <div class="h-5 border-b bg-muted/20 shrink-0" />
          <div ref={labelsRef!} class="flex-1 overflow-hidden">
            <For each={props.tracks}>
              {(track, i) => (
                  <div
                    class="h-16 border-b flex items-center px-3 text-xs text-muted-foreground truncate"
                    style={{ "border-left": `3px solid ${trackColor(i(), track)}` }}
                  >
                    {track.label}
                  </div>
              )}
            </For>
          </div>
        </div>

        {/* Right: Ruler + Tracks */}
        <div ref={rightRef!} class="flex-1 flex flex-col min-w-0 relative overflow-hidden">
          {/* Ruler (hidden overflow, scrollLeft synced from tracks) */}
          <div ref={rulerRef!} class="overflow-hidden shrink-0 border-b bg-muted/20">
            <div
              class="relative h-5 text-[10px] text-muted-foreground cursor-pointer"
              style={{ width: `${totalPx()}px`, "min-width": "100%" }}
              onClick={onRulerClick}
            >
              {Array.from({ length: Math.ceil(props.duration / rulerInterval()) + 1 }, (_, i) => (
                <div
                  class="absolute top-0 h-full border-l border-muted-foreground/20 pl-0.5 leading-tight"
                  style={{ left: `${i * rulerInterval() * pxPerMs()}px` }}
                >
                  {msToRuler(i * rulerInterval())}
                </div>
              ))}
            </div>
          </div>

          {/* Tracks (main scroll container — user scrolls here) */}
          <div ref={tracksRef!} class="flex-1 overflow-auto min-h-0" onScroll={handleTrackScroll}>
            <div class="relative" style={{ width: `${totalPx()}px`, "min-width": "100%" }}>
              <For each={props.tracks}>
                {(track, i) => {
                  const c = trackColor(i(), track);
                  return (
                    <div class="h-16 border-b relative">
                      <For each={track.segments}>
                        {(seg) => (
                          <div
                            class="absolute top-1 h-12 rounded cursor-pointer truncate text-xs px-2 border flex items-center hover:opacity-80"
                            style={{
                              left: `${seg.startMs * pxPerMs()}px`,
                              width: `${Math.max((seg.endMs - seg.startMs) * pxPerMs(), 4)}px`,
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
          {/* Playhead */}
          <div
            class="absolute top-0 h-full w-0.5 bg-red-500/50 z-10 pointer-events-none"
            style={{ left: `${playheadLeft()}px` }}
          >
            <div
              class="absolute -top-1.5 -left-1.5 w-3 h-3 rounded-full bg-red-500 border-2 border-white shadow-sm cursor-pointer pointer-events-auto"
              onPointerDown={onPlayheadDown}
              onPointerMove={onPlayheadMove}
              onPointerUp={onPlayheadUp}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
