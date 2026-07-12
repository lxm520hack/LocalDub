import { createSignal, Show } from "solid-js";
import { fnrpc } from "#/integrations/fnrpc/client.ts";
import { VideoPanel } from "./VideoPanel";
import { VideoControls } from "./VideoControls";
import { Timeline } from "./Timeline";
import { TaskControlPanel } from "#/components/pages/task/TaskControlPanel.tsx";
import { AiReviewPanel } from "#/components/pages/task/AiReviewPanel.tsx";

interface SubtitleSegment {
  index: number;
  text: string;
  translation?: string;
  startMs: number;
  endMs: number;
}

interface Props {
  groupId: string;
  taskId: string;
}

export function TaskDetailPage(props: Props) {
  const taskDir = `workfolder/${props.groupId}/${props.taskId}`;
  const taskCtxQ = fnrpc.createQuery(() => ['get_task_ctx', taskDir]);
  const [videoRef, setVideoRef] = createSignal<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [playbackRate, setPlaybackRate] = createSignal(1);

  const videoUrl = () => taskCtxQ.data?.video_source_path
    ? `http://localhost:19110/media/${taskDir}/video_source.mp4`
    : "";

  const onVideoReady = (ref: HTMLVideoElement) => {
    setVideoRef(ref);
    setDuration(ref.duration * 1000);
    ref.addEventListener("timeupdate", () => setCurrentTime(ref.currentTime * 1000));
    ref.addEventListener("play", () => setPlaying(true));
    ref.addEventListener("pause", () => setPlaying(false));
  };

  const togglePlay = () => {
    const v = videoRef();
    if (!v) return;
    v.paused ? v.play() : v.pause();
  };

  const onRateChange = (rate: number) => {
    const v = videoRef();
    if (v) v.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const onSeek = (ms: number) => {
    const v = videoRef();
    if (v) v.currentTime = ms / 1000;
  };

  const segments = (): SubtitleSegment[] => [];

  return (
    <div class="flex flex-col h-full w-full min-w-0 max-w-full">
      <div class="flex h-120">
        <TaskControlPanel />
        <div class="flex-1 min-w-0 flex flex-col">
          <Show when={videoUrl()} fallback={
            <div class="flex-1 flex items-center justify-center bg-black text-muted-foreground">
              <Show when={taskCtxQ.isPending} fallback="No video source">
                Loading...
              </Show>
            </div>
          }>
            <div class="flex-1 min-h-0">
              <VideoPanel videoPath={videoUrl()} onReady={onVideoReady} />
            </div>
            <VideoControls
              playing={playing()}
              currentTime={currentTime()}
              duration={duration()}
              playbackRate={playbackRate()}
              onTogglePlay={togglePlay}
              onRateChange={onRateChange}
            />
          </Show>
        </div>
        <AiReviewPanel />
      </div>

      <div class="flex-1">
        <Timeline
          segments={segments()}
          duration={duration()}
          onSeek={onSeek}
        />
      </div>
    </div>
  );
}
