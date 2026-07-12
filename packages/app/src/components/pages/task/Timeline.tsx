import { createSignal, For } from "solid-js";
import { ZoomIn, ZoomOut } from "lucide-solid";
import { ScrollAreaH } from "@repo/ui-solid/base/scroll-area-h";

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
  onSeek: (ms: number) => void;
}

const BASE_PX_PER_MS = 0.08; // 1x = 80px/s

function msToRuler(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Timeline(props: Props) {
  const [zoom, setZoom] = createSignal(1);
  const pxPerMs = () => BASE_PX_PER_MS * zoom();
  const totalPx = () => props.duration * pxPerMs();

  // Ruler interval: aim for ~80px between marks
  const rulerInterval = () => {
    const raw = 80 / pxPerMs();
    const steps = [500, 1000, 2000, 5000, 10000, 30000, 60000];
    return steps.find(s => s >= raw) ?? 60000;
  };

  return (
    
    <div class="flex flex-col h-full bg-muted/30 border-t select-none">
      {/* Toolbar: zoom */}
      <div class="flex items-center h-7 px-2 gap-2 border-b bg-muted/20 flex-shrink-0">
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
      {/* 左侧轨道信息 — 固定 + 右侧滚动内容 */}
      <div class="flex flex-1 overflow-hidden">
        {/* 左侧轨道信息 — 固定 */}
        <div class="w-20 shrink-0 border-r">
          <div class="h-5 border-b bg-muted/20" />
          <div class="h-8 border-b flex items-center px-2 text-xs text-muted-foreground">源语言</div>
          <div class="h-8 border-b flex items-center px-2 text-xs text-muted-foreground">翻译</div>
        </div>

        {/* 右侧内容 — 水平滚动 */}
        <ScrollAreaH scrollbarSize={10} class="flex-1">
          <div class="relative" style={{ width: `${totalPx()}px`, "min-width": "100%" }}>
            {/* Ruler */}
            <div class="h-5 relative border-b bg-muted/20 text-[10px] text-muted-foreground">
              <div style={{ width: `${totalPx()}px` }} class="relative h-full">
                <div
                  class="absolute left-0 top-0 h-full w-0.5 bg-red-500/50 z-10 pointer-events-none"
                  style={{ left: `${totalPx()}px` }}
                />
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

            {/* Tracks */}
            <div class="flex flex-col">
              {/* Source track */}
              <div class="flex h-8 border-b">
                <div class="flex-1 relative">
                  <div style={{ width: `${totalPx()}px` }} class="relative h-full">
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
              </div>

              {/* Translation track */}
              <div class="flex h-8 border-b">
                <div class="flex-1 relative">
                  <div style={{ width: `${totalPx()}px` }} class="relative h-full">
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
              </div>
            </div>
          </div>
        </ScrollAreaH>
      </div>
    </div>
  );
}
