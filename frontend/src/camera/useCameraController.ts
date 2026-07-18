import { useCallback, useEffect, useRef, useState } from "react";

export type CameraErrorCode = "unsupported" | "permission_denied" | "not_found" | "in_use" | "constraints" | "playback" | "interrupted" | "unknown";

export interface CameraProblem {
  code: CameraErrorCode;
  message: string;
}

export function cameraProblem(error: unknown): CameraProblem {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return { code: "permission_denied", message: "Camera permission is blocked. Allow camera access in Safari Settings, then try again." };
  if (name === "NotFoundError") return { code: "not_found", message: "No camera was found. Connect a camera or upload an image." };
  if (name === "NotReadableError" || name === "AbortError") return { code: "in_use", message: "The camera is unavailable or being used by another app. Close it there and retry." };
  if (name === "OverconstrainedError") return { code: "constraints", message: "This camera cannot satisfy the requested settings. Choose another camera." };
  return { code: "unknown", message: "The camera could not start. Retry or use image files instead." };
}

export function useCameraController() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [starting, setStarting] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef<Promise<MediaStream | null> | null>(null);
  const lastDeviceRef = useRef<string | undefined>(undefined);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
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
    const preferred: MediaStreamConstraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    };
    const request = (async () => {
      try {
        let selected: MediaStream;
        try {
          selected = await navigator.mediaDevices.getUserMedia(preferred);
        } catch (error) {
          if (deviceId || error instanceof DOMException && ["NotAllowedError", "SecurityError", "NotReadableError"].includes(error.name)) throw error;
          selected = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        }
        streamRef.current = selected;
        setStream(selected);
        const available = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
        setDevices(available.filter((item) => item.kind === "videoinput"));
        for (const track of selected.getVideoTracks()) {
          track.addEventListener("ended", () => setProblem({ code: "interrupted", message: "The camera stopped. Tap Recover camera to continue." }), { once: true });
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

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && streamRef.current && streamRef.current.getVideoTracks().every((track) => track.readyState === "ended")) {
        setProblem({ code: "interrupted", message: "The camera stopped while Safari was in the background. Tap Recover camera." });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { document.removeEventListener("visibilitychange", onVisibility); stop(); };
  }, [stop]);

  return { stream, devices, problem, starting, start, stop, switchCamera, recover, reportPlaybackProblem };
}
