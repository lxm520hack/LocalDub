import { createSignal, Show } from "solid-js";
import { fnrpc } from "#/integrations/fnrpc/client.ts";
import { VideoPanel } from "./VideoPanel";
import { Timeline } from "./Timeline";

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
  const [currentTime, setCurrentTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);

  const videoPath = () => taskCtxQ.data?.video_source_path ?? "";

  // Placeholder segments — will be loaded from ASR + translation JSON
  const segments = (): SubtitleSegment[] => [];

  return (
    <div class="flex flex-col h-full">
      {/* Video area */}
      <Show when={videoPath()} fallback={
        <div class="flex-1 flex items-center justify-center bg-black text-muted-foreground">
          <Show when={taskCtxQ.isPending} fallback="No video source">
            Loading...
          </Show>
        </div>
      }>
        <div class="flex-1 min-h-0">
          <VideoPanel
            videoPath={videoPath()}
            onTimeUpdate={setCurrentTime}
            onDurationChange={setDuration}
          />
        </div>
      </Show>

      {/* Timeline */}
      <div class="h-24 flex-shrink-0">
        <Timeline
          segments={segments()}
          duration={duration()}
          currentTime={currentTime()}
          onSeek={(ms) => {
            const video = document.querySelector("video");
            if (video) video.currentTime = ms / 1000;
          }}
        />
      </div>
    </div>
  );
}
