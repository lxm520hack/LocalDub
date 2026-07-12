
interface Props {
  videoPath: string;
  onTimeUpdate: (t: number) => void;
  onDurationChange: (d: number) => void;
}

export function VideoPanel(props: Props) {
  let videoRef!: HTMLVideoElement;

  return (
    <div class="flex items-center justify-center bg-black h-full w-full overflow-hidden">
      <video
        ref={videoRef}
        src={props.videoPath}
        controls
        class="max-h-full max-w-full object-contain"
        onTimeUpdate={() => props.onTimeUpdate(videoRef.currentTime * 1000)}
        onDurationChange={() => props.onDurationChange(videoRef.duration * 1000)}
      />
    </div>
  );
}
