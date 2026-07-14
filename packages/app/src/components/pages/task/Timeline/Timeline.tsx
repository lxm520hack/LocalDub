import { createSignal } from "solid-js";
import { useScrollSync } from "#/hooks/useScrollSync";
import { TimelineToolbar } from "./TimelineToolbar";
import { TimelineRuler } from "./TimelineRuler";
import { TimelineTrackSide } from "./TimelineTrackSide";
import { TimelineTracks } from "./TimelineTracks";
import { BASE_PX_PER_MS, rulerInterval, trackColor } from "./consts";
export type { Track, TrackSegment } from "./consts";
import type { Track } from "./consts";

interface Props {
  tracks: Track[];
  duration: number;
  currentTime: number;
  onSeek: (ms: number) => void;
}

export function Timeline(props: Props) {
  const [zoom, setZoom] = createSignal(1);
  const pxPerMs = () => BASE_PX_PER_MS * zoom();
  const totalPx = () => props.duration * pxPerMs();
  const ri = () => rulerInterval(pxPerMs());

  let tracksRef!: HTMLDivElement;
  let rulerRef!: HTMLDivElement;
  let labelsRef!: HTMLDivElement;

  const [scrollLeft, setScrollLeft] = createSignal(0);

  const handleTrackScroll = () => {
    setScrollLeft(tracksRef?.scrollLeft ?? 0);
  };

  useScrollSync(
    () => tracksRef,
    () => rulerRef,
    () => labelsRef,
  );

  const playheadLeft = () => props.currentTime * pxPerMs() - scrollLeft();

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

  return (
    <div class="flex flex-col h-full  border-t select-none">
      <TimelineToolbar zoom={zoom()} onZoomChange={setZoom} />

      <div class="flex flex-1 overflow-hidden">
        <TimelineTrackSide
          ref={(el) => labelsRef = el}
          tracks={props.tracks}
          trackColor={trackColor}
        />

        <div ref={rightRef!} class="flex-1 flex flex-col min-w-0 relative overflow-hidden">
          <TimelineRuler
            ref={(el) => rulerRef = el}
            totalPx={totalPx()}
            duration={props.duration}
            interval={ri()}
            pxPerMs={pxPerMs()}
            onRulerClick={onRulerClick}
          />

          <TimelineTracks
            ref={(el) => tracksRef = el}
            tracks={props.tracks}
            totalPx={totalPx()}
            pxPerMs={pxPerMs()}
            onSeek={props.onSeek}
            trackColor={trackColor}
            onScroll={handleTrackScroll}
          />

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
