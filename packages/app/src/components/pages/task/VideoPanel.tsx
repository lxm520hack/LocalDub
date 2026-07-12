import { isTauri, convertFileSrc } from "@tauri-apps/api/core";

interface Props {
  videoPath: string;
  onTimeUpdate: (t: number) => void;
  onDurationChange: (d: number) => void;
}

export function VideoPanel(props: Props) {
  let videoRef!: HTMLVideoElement;

  const src = isTauri() ? convertFileSrc(props.videoPath) : props.videoPath;

  return (
    <div class="flex items-center justify-center bg-black h-full w-full overflow-hidden">
      <video
        ref={videoRef}
        src={src}
        controls
        class="max-h-full max-w-full object-contain"
        onTimeUpdate={() => props.onTimeUpdate(videoRef.currentTime * 1000)}
        onDurationChange={() => props.onDurationChange(videoRef.duration * 1000)}
      />
    </div>
  );
}
