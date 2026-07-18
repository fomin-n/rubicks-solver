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

interface Props {
  stream: MediaStream | null;
  devices: MediaDeviceInfo[];
  problem: CameraProblem | null;
  busy: boolean;
  captureKey: string;
  autoEnabled: boolean;
  onAutoChange: (enabled: boolean) => void;
  onCapture: (blob: Blob, source: "auto" | "manual" | "upload") => void;
  onSwitchCamera: (deviceId: string) => void;
  onRecover: () => void;
  onPlaybackProblem: (message: string) => void;
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
  const { stream, onPlaybackProblem, onCapture } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const previousLumaRef = useRef<Uint8Array | undefined>(undefined);
  const machineRef = useRef<AutoCaptureState>({ ...INITIAL_AUTO_CAPTURE_STATE });
  const capturePendingRef = useRef(false);
  const [machine, setMachine] = useState(machineRef.current);
  const [metrics, setMetrics] = useState<CaptureMetrics | null>(null);

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
    video.playsInline = true;
    video.srcObject = stream;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled && (!video.videoWidth || !video.videoHeight)) onPlaybackProblem("Safari has not produced camera frames. Tap Recover camera or reload the page.");
    }, 5_000);
    const play = async () => {
      try { await video.play(); }
      catch { if (!cancelled) onPlaybackProblem("Safari paused the preview. Tap Recover camera to resume."); }
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) void play();
    else video.addEventListener("loadedmetadata", () => void play(), { once: true });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      video.pause();
      video.srcObject = null;
    };
  }, [stream, onPlaybackProblem]);

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
    {props.stream ? <>
      <video ref={videoRef} autoPlay muted playsInline className="camera-video" aria-label="Live camera preview" />
      <div className="scan-guide" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className={`capture-readiness ${machine.status}`} role="status">
        <span>{status}</span>
        {props.autoEnabled && <progress max="1" value={machine.progress} aria-label="Auto-capture hold progress" />}
      </div>
    </> : <div className="camera-placeholder">Camera-free image mode</div>}
    {props.problem && <div className="camera-problem" role="alert"><span>{props.problem.message}</span><button onClick={props.onRecover}>Recover camera</button></div>}
    <div className="camera-actions">
      <label className="toggle"><input type="checkbox" checked={props.autoEnabled} onChange={(event) => props.onAutoChange(event.target.checked)} /> Auto capture</label>
      {props.devices.length > 1 && <label>Camera <select onChange={(event) => props.onSwitchCamera(event.target.value)} defaultValue="">
        <option value="" disabled>Choose…</option>
        {props.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
      </select></label>}
      {props.stream && <button disabled={props.busy} onClick={() => void capture("manual")}>{props.busy ? "Processing…" : "Capture manually"}</button>}
      <label className="button secondary">Upload image<input className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) props.onCapture(file, "upload");
        event.currentTarget.value = "";
      }} /></label>
    </div>
    {debugEnabled && metrics && <details className="capture-debug" open><summary>Capture diagnostics</summary><pre>{JSON.stringify({
      metrics,
      thresholds: {
        warningMinBrightness: AUTO_CAPTURE_CONFIG.warningMinBrightness,
        hardMinBrightness: AUTO_CAPTURE_CONFIG.hardMinBrightness,
        warningMaxDarkFraction: AUTO_CAPTURE_CONFIG.warningMaxDarkFraction,
        hardMaxDarkFraction: AUTO_CAPTURE_CONFIG.hardMaxDarkFraction,
      },
      decision: {
        blockingReason: machine.blockingReason,
        warnings: machine.warnings,
        countsTowardHold: machine.countsTowardHold,
      },
      machine,
    }, null, 2)}</pre></details>}
  </div>;
}
