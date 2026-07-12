interface Props {
  videoPath: string;
  onReady: (ref: HTMLVideoElement) => void;
}

export function VideoPanel(props: Props) {
  let videoRef!: HTMLVideoElement;

  return (
    <div class="flex items-center justify-center bg-black h-full w-full overflow-hidden">
      <video
        ref={videoRef}
        src={props.videoPath}
        // controls
        class="max-h-full max-w-full object-contain"
        onLoadedMetadata={() => props.onReady(videoRef)}
      />
    </div>
  );
}
