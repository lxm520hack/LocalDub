import { For } from "solid-js";
import { msToRuler } from "./consts";

interface Props {
  ref: (el: HTMLDivElement) => void;
  totalPx: number;
  duration: number;
  interval: number;
  pxPerMs: number;
  onRulerClick: (e: MouseEvent) => void;
}

export function TimelineRuler(props: Props) {
  const tickCount = Math.ceil(props.duration / props.interval) + 1;

  return (
    <div ref={props.ref} class="overflow-hidden shrink-0 border-b bg-muted/20">
      <div
        class="relative h-5 text-[10px] text-muted-foreground cursor-pointer"
        style={{ width: `${props.totalPx}px`, "min-width": "100%" }}
        onClick={props.onRulerClick}
      >
        <For each={Array.from({ length: tickCount }, (_, i) => i)}>
          {(i) => (
            <div
              class="absolute top-0 h-full border-l border-muted-foreground/20 pl-0.5 leading-tight"
              style={{ left: `${i * props.interval * props.pxPerMs}px` }}
            >
              {msToRuler(i * props.interval)}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
