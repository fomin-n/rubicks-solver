import { useEffect, useRef } from "react";

interface Props {
  stream: MediaStream;
  label: string;
  onPlaybackProblem: (message: string) => void;
}

export function LiveCameraVideo({ stream, label, onPlaybackProblem }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    let cancelled = false;
    const play = async () => {
      try { await video.play(); }
      catch { if (!cancelled) onPlaybackProblem("Safari paused the guidance camera. Tap the preview to resume."); }
    };
    const onLoadedMetadata = () => void play();
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) void play();
    else video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.pause();
      video.srcObject = null;
    };
  }, [stream, onPlaybackProblem]);

  return <video ref={videoRef} autoPlay muted playsInline className="camera-video" aria-label={label} />;
}
