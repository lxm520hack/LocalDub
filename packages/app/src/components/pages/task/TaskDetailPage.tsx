import { createSignal, Show } from "solid-js";
import { fnrpc } from "#/integrations/fnrpc/client.ts";
import { VideoPanel } from "./VideoPanel";
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
  const [currentTime, setCurrentTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);

  const videoPath = () => taskCtxQ.data?.video_source_path ?? "";

  // Placeholder segments — will be loaded from ASR + translation JSON
  const segments = (): SubtitleSegment[] => [];

  return (
    <div class="flex flex-col h-full">
      {/* Top row: three columns */}
      <div class="flex h-120">
        <TaskControlPanel />

        {/* Video player */}
        <div class="flex-1 min-w-0">
          <Show when={videoPath()} fallback={
            <div class="h-full flex items-center justify-center bg-black text-muted-foreground">
              <Show when={taskCtxQ.isPending} fallback="No video source">
                Loading...
              </Show>
            </div>
          }>
            <VideoPanel
              videoPath={videoPath()}
              onTimeUpdate={setCurrentTime}
              onDurationChange={setDuration}
            />
          </Show>
        </div>

        <AiReviewPanel />
      </div>

      {/* Timeline */}
      <div class=" flex-1">
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
