import { createSignal, Show } from "solid-js";
import { fnrpc } from "#/integrations/fnrpc/client.ts";
import { VideoPanel } from "./VideoPanel";
import { VideoControls } from "./VideoControls";
import { Timeline, type Track } from "./Timeline";
import { TaskControlPanel } from "#/components/pages/task/TaskControlPanel.tsx";
import { AiReviewPanel } from "#/components/pages/task/AiReviewPanel.tsx";

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

  const asrQuery = fnrpc.createQuery(
    () => ['read_app_file_text', `${taskDir}/asr/asr.json`],
  );

  const asrSegments = () => {
    if (!asrQuery.data) return [];
    try {
      const data = JSON.parse(asrQuery.data);
      return (data.result?.segments || []).map((s: any, i: number) => ({
        index: i,
        text: (s.text || '').trim(),
        startMs: s.start,
        endMs: s.end,
      })).filter((s: { text: string }) => s.text);
    } catch { return []; }
  };

  const transLang = () => taskCtxQ.data?.target_language;

  const transQuery = fnrpc.createQuery(
    () => ['read_app_file_text', `${taskDir}/translate/translation.${transLang()}.json`],
    () => ({ enabled: !!transLang(), initialData: '' }),
  );

  const transSegments = () => {
    if (!transQuery.data) return [];
    try {
      const data = JSON.parse(transQuery.data);
      return (data.translation || []).map((item: any, i: number) => ({
        index: i,
        text: item.dst || '',
        startMs: item.start_time * 1000,
        endMs: item.end_time * 1000,
      }));
    } catch { return []; }
  };

  const tracks = (): Track[] => {
    const result: Track[] = [];
    const asr = asrSegments();
    if (asr.length) {
      result.push({ id: 'asr', label: 'asr.json', segments: asr, color: '#3b82f6' });
    }
    const trans = transSegments();
    if (trans.length) {
      result.push({ id: 'translation', label: `translation.${transLang()}.json`, segments: trans, color: '#22c55e' });
    }
    return result;
  };

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
          tracks={tracks()}
          duration={duration()}
          currentTime={currentTime()}
          onSeek={onSeek}
        />
      </div>
    </div>
  );
}
