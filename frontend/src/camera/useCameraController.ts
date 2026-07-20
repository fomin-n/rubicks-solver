import { useCallback, useEffect, useRef, useState } from "react";

export type CameraErrorCode = "unsupported" | "permission_denied" | "not_found" | "in_use" | "constraints" | "playback" | "interrupted" | "unknown";

export interface CameraProblem {
  code: CameraErrorCode;
  message: string;
}

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : "";
}

export function cameraProblem(error: unknown): CameraProblem {
  const name = errorName(error);
  if (name === "NotAllowedError" || name === "SecurityError") return { code: "permission_denied", message: "Camera permission is blocked. Allow camera access in Safari Settings, then try again." };
  if (name === "NotFoundError") return { code: "not_found", message: "No camera was found. Connect a camera or upload an image." };
  if (name === "NotReadableError" || name === "AbortError") return { code: "in_use", message: "The camera is unavailable or being used by another app. Close it there and retry." };
  if (name === "OverconstrainedError") return { code: "constraints", message: "This camera cannot satisfy the requested settings. Choose another camera." };
  return { code: "unknown", message: "The camera could not start. Retry or use image files instead." };
}

export function useCameraController() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [starting, setStarting] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef<Promise<MediaStream | null> | null>(null);
  const lastDeviceRef = useRef<string | undefined>(undefined);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setSelectedDeviceId(null);
  }, []);

  const start = useCallback(async (deviceId?: string): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem({ code: "unsupported", message: "This browser does not support camera access. Use image files instead." });
      return false;
    }
    if (requestRef.current) return Boolean(await requestRef.current);
    setStarting(true);
    setProblem(null);
    stop();
    lastDeviceRef.current = deviceId;
    const candidates: MediaStreamConstraints[] = [
      ...(deviceId ? [{ audio: false, video: { deviceId: { exact: deviceId } } } satisfies MediaStreamConstraints] : []),
      { audio: false, video: { facingMode: { exact: "environment" } } },
      { audio: false, video: { facingMode: { ideal: "environment" } } },
      { audio: false, video: true },
    ];
    const request = (async () => {
      try {
        let selected: MediaStream | null = null;
        let lastError: unknown;
        for (const constraints of candidates) {
          try {
            selected = await navigator.mediaDevices.getUserMedia(constraints);
            break;
          } catch (error) {
            lastError = error;
            if (["NotAllowedError", "SecurityError", "NotReadableError", "AbortError"].includes(errorName(error))) throw error;
          }
        }
        if (!selected) throw lastError ?? new DOMException("No camera stream was returned", "NotFoundError");
        streamRef.current = selected;
        setStream(selected);
        const available = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
        const videoDevices = available.filter((item) => item.kind === "videoinput");
        setDevices(videoDevices);
        const selectedTrack = selected.getVideoTracks()[0];
        const settingsId = selectedTrack?.getSettings?.().deviceId;
        const matchingId = settingsId && videoDevices.some((item) => item.deviceId === settingsId)
          ? settingsId
          : videoDevices.find((item) => item.label && item.label === selectedTrack?.label)?.deviceId;
        const activeDeviceId = matchingId ?? null;
        setSelectedDeviceId(activeDeviceId);
        lastDeviceRef.current = activeDeviceId ?? deviceId;
        for (const track of selected.getVideoTracks()) {
          track.addEventListener("ended", () => {
            if (streamRef.current === selected) setProblem({ code: "interrupted", message: "The camera stopped. Tap Recover camera to continue." });
          }, { once: true });
        }
        return selected;
      } catch (error) {
        setProblem(cameraProblem(error));
        return null;
      } finally {
        setStarting(false);
        requestRef.current = null;
      }
    })();
    requestRef.current = request;
    return Boolean(await request);
  }, [stop]);

  const switchCamera = useCallback((deviceId: string) => start(deviceId), [start]);
  const recover = useCallback(() => start(lastDeviceRef.current), [start]);
  const reportPlaybackProblem = useCallback((message: string) => setProblem({ code: "playback", message }), []);
  const clearProblem = useCallback(() => setProblem(null), []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && streamRef.current && streamRef.current.getVideoTracks().every((track) => track.readyState === "ended")) {
        setProblem({ code: "interrupted", message: "The camera stopped while Safari was in the background. Tap Recover camera." });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { document.removeEventListener("visibilitychange", onVisibility); stop(); };
  }, [stop]);

  return { stream, devices, selectedDeviceId, problem, starting, start, stop, switchCamera, recover, reportPlaybackProblem, clearProblem };
}
