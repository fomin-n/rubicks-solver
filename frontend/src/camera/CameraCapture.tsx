import { useEffect, useRef, useState } from "react";

interface Props {
  stream: MediaStream | null;
  busy: boolean;
  onCapture: (blob: Blob) => void;
  onSwitchCamera: (deviceId: string) => void;
}

export function CameraCapture({ stream, busy, onCapture, onSwitchCamera }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
      void video.play();
      void navigator.mediaDevices.enumerateDevices().then((all) => setDevices(all.filter((item) => item.kind === "videoinput")));
    }
  }, [stream]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const bounds = video.getBoundingClientRect();
    const scale = Math.max(bounds.width / video.videoWidth, bounds.height / video.videoHeight);
    const renderedWidth = video.videoWidth * scale;
    const renderedHeight = video.videoHeight * scale;
    const cropSizeCss = Math.min(bounds.width, bounds.height) * 0.72;
    const sourceX = ((bounds.width - cropSizeCss) / 2 + (renderedWidth - bounds.width) / 2) / scale;
    const sourceY = ((bounds.height - cropSizeCss) / 2 + (renderedHeight - bounds.height) / 2) / scale;
    const sourceSize = cropSizeCss / scale;
    const canvas = document.createElement("canvas");
    canvas.width = 768; canvas.height = 768;
    canvas.getContext("2d")?.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, 0, 0, 768, 768);
    canvas.toBlob((blob) => { if (blob) onCapture(blob); }, "image/jpeg", 0.9);
  }

  return <div className="camera-stack">
    {stream ? <>
      <video ref={videoRef} muted playsInline className="camera-video" aria-label="Live camera preview" />
      <div className="scan-guide" aria-hidden="true"><i /><i /><i /><i /></div>
    </> : <div className="camera-placeholder">Camera-free image mode</div>}
    <div className="camera-actions">
      {devices.length > 1 && <label>Camera <select onChange={(event) => onSwitchCamera(event.target.value)} defaultValue="">
        <option value="" disabled>Choose…</option>
        {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
      </select></label>}
      {stream && <button className="primary" disabled={busy} onClick={capture}>{busy ? "Processing…" : "Capture face"}</button>}
      <label className="button secondary">Upload image<input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
        const file = event.target.files?.[0]; if (file) onCapture(file); event.currentTarget.value = "";
      }} /></label>
    </div>
  </div>;
}

