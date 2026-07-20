import { useCallback, useEffect, useRef, useState } from "react";
import { analyzePixels } from "./analyzer";
import {
  AUTO_CAPTURE_CONFIG,
  INITIAL_AUTO_CAPTURE_STATE,
  READINESS_MESSAGES,
  advanceAutoCapture,
  resetAutoCapture,
  type AutoCaptureState,
  type CaptureMetrics,
} from "./autoCapture";
import type { CameraProblem } from "./useCameraController";
import type { CaptureSource } from "./capturePolicy";

interface Props {
  stream: MediaStream | null;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  problem: CameraProblem | null;
  busy: boolean;
  captureKey: string;
  autoEnabled: boolean;
  onAutoChange: (enabled: boolean) => void;
  onCapture: (blob: Blob, source: CaptureSource) => void;
  onSwitchCamera: (deviceId?: string) => void;
  onRecover: () => void;
  onPlaybackProblem: (message: string) => void;
  onPlaybackRecovered: () => void;
}

const debugEnabled = new URLSearchParams(window.location.search).get("captureDebug") === "1";
interface E2ECameraBridge {
  metrics?: () => CaptureMetrics;
  captureBlob?: () => Promise<Blob>;
}
function e2eBridge(): E2ECameraBridge | undefined {
  return import.meta.env.VITE_E2E === "1" ? (window as unknown as { __rubiksE2ECamera?: E2ECameraBridge }).__rubiksE2ECamera : undefined;
}

// Exported for exact object-fit ROI tests.
// eslint-disable-next-line react-refresh/only-export-components
export async function captureVideoRoi(video: HTMLVideoElement, size = 768): Promise<Blob | null> {
  const injectedBlob = e2eBridge()?.captureBlob;
  if (injectedBlob) return await injectedBlob();
  if (!video.videoWidth || !video.videoHeight) return null;
  const bounds = video.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const scale = Math.max(bounds.width / video.videoWidth, bounds.height / video.videoHeight);
  const renderedWidth = video.videoWidth * scale;
  const renderedHeight = video.videoHeight * scale;
  const cropSizeCss = Math.min(bounds.width, bounds.height) * 0.72;
  const sourceX = ((bounds.width - cropSizeCss) / 2 + (renderedWidth - bounds.width) / 2) / scale;
  const sourceY = ((bounds.height - cropSizeCss) / 2 + (renderedHeight - bounds.height) / 2) / scale;
  const sourceSize = cropSizeCss / scale;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d")?.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
  return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
}

function analysisPixels(video: HTMLVideoElement, canvas: HTMLCanvasElement): Uint8ClampedArray | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const bounds = video.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const scale = Math.max(bounds.width / video.videoWidth, bounds.height / video.videoHeight);
  const renderedWidth = video.videoWidth * scale;
  const renderedHeight = video.videoHeight * scale;
  const cropSizeCss = Math.min(bounds.width, bounds.height) * 0.72;
  const sourceX = ((bounds.width - cropSizeCss) / 2 + (renderedWidth - bounds.width) / 2) / scale;
  const sourceY = ((bounds.height - cropSizeCss) / 2 + (renderedHeight - bounds.height) / 2) / scale;
  const sourceSize = cropSizeCss / scale;
  canvas.width = AUTO_CAPTURE_CONFIG.analysisSize;
  canvas.height = AUTO_CAPTURE_CONFIG.analysisSize;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

export function CameraCapture(props: Props) {
  const { stream, onPlaybackProblem, onPlaybackRecovered, onCapture } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasPreviewActiveRef = useRef(false);
  const analysisCanvasRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const previousLumaRef = useRef<Uint8Array | undefined>(undefined);
  const machineRef = useRef<AutoCaptureState>({ ...INITIAL_AUTO_CAPTURE_STATE });
  const capturePendingRef = useRef(false);
  const [machine, setMachine] = useState(machineRef.current);
  const [metrics, setMetrics] = useState<CaptureMetrics | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [canvasPreviewActive, setCanvasPreviewActive] = useState(false);

  const resumePreview = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setPlaybackBlocked(false);
      setPreviewPlaying(Boolean(video.videoWidth && video.videoHeight));
      onPlaybackRecovered();
    } catch {
      setPlaybackBlocked(true);
      onPlaybackProblem("Safari blocked the live preview. Tap Show camera preview again, or reload Safari.");
    }
  }, [onPlaybackProblem, onPlaybackRecovered]);

  useEffect(() => {
    setPreviewPlaying(false);
    setCanvasPreviewActive(false);
    canvasPreviewActiveRef.current = false;
  }, [stream]);

  useEffect(() => {
    if (!["cooldown", "scene_change"].includes(machineRef.current.phase)) {
      machineRef.current = resetAutoCapture();
      previousLumaRef.current = undefined;
    }
    capturePendingRef.current = false;
    setMachine(machineRef.current);
  }, [props.captureKey]);

  useEffect(() => {
    if (!props.busy) capturePendingRef.current = false;
  }, [props.busy]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.autoplay = true;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.srcObject = stream;
    setPlaybackBlocked(false);
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled && (!video.videoWidth || !video.videoHeight)) {
        setPlaybackBlocked(true);
        onPlaybackProblem("Safari has not displayed camera frames. Tap Show camera preview, or reload Safari.");
      }
    }, 6_000);
    const play = async () => {
      try {
        await video.play();
        if (!cancelled) {
          setPlaybackBlocked(false);
          setPreviewPlaying(Boolean(video.videoWidth && video.videoHeight));
          onPlaybackRecovered();
        }
      } catch {
        if (!cancelled) {
          setPlaybackBlocked(true);
          onPlaybackProblem("Safari paused the preview. Tap Show camera preview to resume.");
        }
      }
    };
    const handleReady = () => void play();
    const handlePlaying = () => {
      if (!cancelled) {
        setPlaybackBlocked(false);
        setPreviewPlaying(Boolean(video.videoWidth && video.videoHeight));
        onPlaybackRecovered();
      }
    };
    const handleFrameReady = () => {
      if (!cancelled && video.videoWidth && video.videoHeight && !video.paused) {
        setPlaybackBlocked(false);
        setPreviewPlaying(true);
        onPlaybackRecovered();
      }
    };
    void play();
    video.addEventListener("loadedmetadata", handleReady, { once: true });
    video.addEventListener("canplay", handleReady, { once: true });
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("loadeddata", handleFrameReady);
    video.addEventListener("resize", handleFrameReady);
    for (const track of stream.getVideoTracks()) track.addEventListener("unmute", handleReady, { once: true });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", handleReady);
      video.removeEventListener("canplay", handleReady);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("loadeddata", handleFrameReady);
      video.removeEventListener("resize", handleFrameReady);
      for (const track of stream.getVideoTracks()) track.removeEventListener("unmute", handleReady);
      video.pause();
      video.srcObject = null;
    };
  }, [stream, onPlaybackProblem, onPlaybackRecovered]);

  // Some iPhone WebKit camera sessions deliver live frames while the native
  // video compositor remains black. Paint those same frames into a normal
  // canvas layer so scanning does not depend on that compositor path.
  useEffect(() => {
    const video = videoRef.current;
    const canvas = previewCanvasRef.current;
    if (!video || !canvas || !stream) return;
    let cancelled = false;
    let timer = 0;
    let lastDraw = 0;

    const schedule = () => {
      if (cancelled) return;
      // Do not rely on requestVideoFrameCallback here: the exact iPhone
      // failure this layer handles can stop presentation callbacks even while
      // getUserMedia continues delivering a live track.
      timer = window.setTimeout(() => drawFrame(performance.now()), 50);
    };
    const drawFrame = (now: number) => {
      if (cancelled) return;
      if (now - lastDraw >= 45 && video.videoWidth && video.videoHeight) {
        const bounds = canvas.getBoundingClientRect();
        if (bounds.width && bounds.height) {
          const sourceScale = Math.max(bounds.width / video.videoWidth, bounds.height / video.videoHeight);
          const sourceWidth = bounds.width / sourceScale;
          const sourceHeight = bounds.height / sourceScale;
          const sourceX = (video.videoWidth - sourceWidth) / 2;
          const sourceY = (video.videoHeight - sourceHeight) / 2;
          const maxScale = 1024 / Math.max(bounds.width, bounds.height);
          const pixelScale = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, maxScale));
          const outputWidth = Math.max(1, Math.round(bounds.width * pixelScale));
          const outputHeight = Math.max(1, Math.round(bounds.height * pixelScale));
          if (canvas.width !== outputWidth) canvas.width = outputWidth;
          if (canvas.height !== outputHeight) canvas.height = outputHeight;
          const context = canvas.getContext("2d", { alpha: false });
          if (context) {
            try {
              context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
              lastDraw = now;
              if (!canvasPreviewActiveRef.current) {
                canvasPreviewActiveRef.current = true;
                setCanvasPreviewActive(true);
              }
            } catch {
              // The next delivered frame gets another chance; native video
              // and the explicit upload control remain available underneath.
            }
          }
        }
      }
      schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [stream]);

  const capture = useCallback(async (source: "auto" | "manual") => {
    const video = videoRef.current;
    if (!video || capturePendingRef.current) return;
    capturePendingRef.current = true;
    const blob = await captureVideoRoi(video);
    if (blob) onCapture(blob, source);
    else capturePendingRef.current = false;
  }, [onCapture]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !props.stream || !props.autoEnabled) return;
    let cancelled = false;
    let lastAnalysis = 0;
    let timer = 0;
    let videoCallback = 0;
    const analyze = (now: number) => {
      if (cancelled) return;
      if (document.visibilityState === "visible" && !props.busy && now - lastAnalysis >= AUTO_CAPTURE_CONFIG.intervalMs) {
        lastAnalysis = now;
        const injectedMetrics = e2eBridge()?.metrics?.();
        const pixels = injectedMetrics ? null : analysisPixels(video, analysisCanvasRef.current);
        if (injectedMetrics || pixels) {
          const result = pixels ? analyzePixels(pixels, previousLumaRef.current) : null;
          const currentMetrics = injectedMetrics ?? result!.metrics;
          const previousPhase = machineRef.current.phase;
          const advanced = advanceAutoCapture(machineRef.current, currentMetrics, performance.now());
          if (result && (!["cooldown", "scene_change"].includes(previousPhase) || advanced.state.phase === "warming")) previousLumaRef.current = result.luma;
          machineRef.current = advanced.state;
          setMachine(advanced.state);
          setMetrics(currentMetrics);
          if (advanced.shouldCapture) {
            navigator.vibrate?.(60);
            void capture("auto");
          }
        }
      }
      schedule();
    };
    const schedule = () => {
      if (e2eBridge()?.metrics) timer = window.setTimeout(() => analyze(performance.now()), AUTO_CAPTURE_CONFIG.intervalMs);
      else if ("requestVideoFrameCallback" in video) videoCallback = video.requestVideoFrameCallback(analyze);
      else timer = window.setTimeout(() => analyze(performance.now()), AUTO_CAPTURE_CONFIG.intervalMs);
    };
    schedule();
    return () => {
      cancelled = true;
      if (videoCallback && "cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(videoCallback);
      window.clearTimeout(timer);
    };
  }, [props.stream, props.autoEnabled, props.busy, capture]);

  const status = props.autoEnabled ? READINESS_MESSAGES[machine.status] : "Auto capture is off";
  return <div className="camera-stack">
    <div className="camera-stage">{props.stream ? <>
      <video ref={videoRef} autoPlay muted playsInline className="camera-video" aria-label="Live camera preview" />
      <canvas ref={previewCanvasRef} className={`camera-preview-canvas${canvasPreviewActive ? " active" : ""}`} aria-hidden="true" />
      <div className="scan-guide" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className={`capture-readiness ${machine.status}`} role="status">
        <span>{status}</span>
        {props.autoEnabled && <progress max="1" value={machine.progress} aria-label="Auto-capture hold progress" />}
      </div>
      {!previewPlaying && !canvasPreviewActive && !playbackBlocked && <button className="camera-preview-prompt" onClick={() => void resumePreview()}>Tap to show camera</button>}
    </> : <div className="camera-placeholder">Camera-free image mode</div>}</div>
    {(props.problem || playbackBlocked) && <div className="camera-problem" role="alert"><span>{props.problem?.message ?? "Safari paused the camera preview."}</span>{props.problem?.code === "playback" || playbackBlocked
      ? <button onClick={() => void resumePreview()}>Show camera preview</button>
      : <button onClick={props.onRecover}>Recover camera</button>}</div>}
    <div className="camera-actions">
      <label className="toggle"><input type="checkbox" checked={props.autoEnabled} onChange={(event) => props.onAutoChange(event.target.checked)} /> Auto capture</label>
      {props.devices.length > 1 && <label>Camera <select aria-label="Camera" disabled={props.busy} onChange={(event) => props.onSwitchCamera(event.target.value || undefined)} value={props.selectedDeviceId ?? ""}>
        <option value="">Automatic rear camera</option>
        {props.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
      </select></label>}
      {props.stream && <button disabled={props.busy} onClick={() => void capture("manual")}>{props.busy ? "Processing…" : "Capture manually"}</button>}
      <label className="button secondary">Upload image<input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) props.onCapture(file, "upload");
        event.currentTarget.value = "";
      }} /></label>
      {debugEnabled && metrics && <details className="capture-debug"><summary>Capture diagnostics</summary><pre>{JSON.stringify({
      metrics,
      thresholds: {
        warningMinBrightness: AUTO_CAPTURE_CONFIG.warningMinBrightness,
        hardMinBrightness: AUTO_CAPTURE_CONFIG.hardMinBrightness,
        warningMaxDarkFraction: AUTO_CAPTURE_CONFIG.warningMaxDarkFraction,
        hardMaxDarkFraction: AUTO_CAPTURE_CONFIG.hardMaxDarkFraction,
        warningMinSharpness: AUTO_CAPTURE_CONFIG.warningMinSharpness,
        hardMinSharpness: AUTO_CAPTURE_CONFIG.hardMinSharpness,
        usableBoundaryStrength: AUTO_CAPTURE_CONFIG.usableBoundaryStrength,
        hardMinBoundaryStrength: AUTO_CAPTURE_CONFIG.hardMinBoundaryStrength,
        stableMotion: AUTO_CAPTURE_CONFIG.stableMotion,
        transientMotion: AUTO_CAPTURE_CONFIG.transientMotion,
        resetMotion: AUTO_CAPTURE_CONFIG.resetMotion,
        warningMinAlignment: AUTO_CAPTURE_CONFIG.warningMinAlignment,
        hardMinAlignment: AUTO_CAPTURE_CONFIG.hardMinAlignment,
      },
      decision: {
        blockingReason: machine.blockingReason,
        warnings: machine.warnings,
        countsTowardHold: machine.countsTowardHold,
        smoothedMotion: machine.smoothedMotion,
      },
      machine,
      }, null, 2)}</pre></details>}
    </div>
  </div>;
}
