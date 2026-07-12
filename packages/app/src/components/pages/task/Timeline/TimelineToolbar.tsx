import { ZoomIn, ZoomOut } from "lucide-solid";

interface Props {
  zoom: number;
  onZoomChange: (z: number) => void;
}

export function TimelineToolbar(props: Props) {
  return (
    <div class="flex items-center h-7 px-2 gap-2 border-b bg-muted/20 shrink-0">
      <button onClick={() => props.onZoomChange(Math.max(0.25, props.zoom / 1.5))} class="hover:text-foreground text-muted-foreground">
        <ZoomOut size={14} />
      </button>
      <input
        type="range"
        min={0.25}
        max={8}
        step={0.05}
        value={props.zoom}
        onInput={(e) => props.onZoomChange(Number(e.currentTarget.value))}
        class="w-20 h-1"
      />
      <button onClick={() => props.onZoomChange(Math.min(8, props.zoom * 1.5))} class="hover:text-foreground text-muted-foreground">
        <ZoomIn size={14} />
      </button>
      <span class="text-[10px] text-muted-foreground">{props.zoom.toFixed(1)}x</span>
    </div>
  );
}
