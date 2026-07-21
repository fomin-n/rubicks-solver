import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { CameraCapture, sourceCropForGuide } from "../src/camera/CameraCapture";
import { cameraProblem, useCameraController } from "../src/camera/useCameraController";

const originalMediaDevices = navigator.mediaDevices;
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
  vi.restoreAllMocks();
});

describe("camera controller", () => {
  it("maps the exact smaller visible guide through object-fit cover", () => {
    const videoBounds = { left: 10, top: 20, width: 390, height: 500 };
    const guideBounds = { left: 135, top: 200, width: 140, height: 140 };
    const crop = sourceCropForGuide(1920, 1080, videoBounds, guideBounds);
    const scale = Math.max(videoBounds.width / 1920, videoBounds.height / 1080);
    const renderedWidth = 1920 * scale;
    const renderedHeight = 1080 * scale;

    expect(crop.sourceX * scale - (renderedWidth - videoBounds.width) / 2 + videoBounds.left).toBeCloseTo(guideBounds.left);
    expect(crop.sourceY * scale - (renderedHeight - videoBounds.height) / 2 + videoBounds.top).toBeCloseTo(guideBounds.top);
    expect(crop.sourceSize * scale).toBeCloseTo(guideBounds.width);
    expect(guideBounds.width).toBeLessThan(Math.min(videoBounds.width, videoBounds.height) * 0.4);
  });

  it("maps browser failures to actionable errors", () => {
    expect(cameraProblem(new DOMException("blocked", "NotAllowedError")).code).toBe("permission_denied");
    expect(cameraProblem(new DOMException("busy", "NotReadableError")).code).toBe("in_use");
    expect(cameraProblem(new DOMException("missing", "NotFoundError")).code).toBe("not_found");
  });

  it("falls back from rear constraints and stops tracks on cleanup", async () => {
    const stop = vi.fn();
    const nextStop = vi.fn();
    const track = { stop, addEventListener: vi.fn(), readyState: "live", label: "Back Camera", getSettings: () => ({ deviceId: "rear-1" }) };
    const nextTrack = { stop: nextStop, addEventListener: vi.fn(), readyState: "live", label: "Wide Back Camera", getSettings: () => ({ deviceId: "rear-2" }) };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    const nextStream = { getTracks: () => [nextTrack], getVideoTracks: () => [nextTrack] } as unknown as MediaStream;
    const devices = [
      { deviceId: "rear-1", kind: "videoinput", label: "Back Camera" },
      { deviceId: "rear-2", kind: "videoinput", label: "Wide Back Camera" },
    ] as MediaDeviceInfo[];
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException("constraints", "OverconstrainedError"))
      .mockResolvedValueOnce(stream)
      .mockResolvedValueOnce(nextStream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue(devices) } });
    const { result, unmount } = renderHook(() => useCameraController());
    await act(async () => { expect(await result.current.start()).toBe(true); });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenNthCalledWith(1, { audio: false, video: { facingMode: { exact: "environment" } } });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: false, video: { facingMode: { ideal: "environment" } } });
    expect(result.current.stream).toBe(stream);
    expect(result.current.selectedDeviceId).toBe("rear-1");
    await act(async () => { expect(await result.current.switchCamera("rear-2")).toBe(true); });
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: false, video: { deviceId: { exact: "rear-2" } } });
    expect(result.current.selectedDeviceId).toBe("rear-2");
    expect(stop).toHaveBeenCalledOnce();
    unmount();
    expect(nextStop).toHaveBeenCalledOnce();
  });

  it("falls back to the rear default when Safari rejects a stale camera id", async () => {
    const firstTrack = { stop: vi.fn(), addEventListener: vi.fn(), readyState: "live", label: "Back Camera", getSettings: () => ({ deviceId: "rear-1" }) };
    const fallbackTrack = { stop: vi.fn(), addEventListener: vi.fn(), readyState: "live", label: "Back Camera", getSettings: () => ({ deviceId: "rear-1" }) };
    const firstStream = { getTracks: () => [firstTrack], getVideoTracks: () => [firstTrack] } as unknown as MediaStream;
    const fallbackStream = { getTracks: () => [fallbackTrack], getVideoTracks: () => [fallbackTrack] } as unknown as MediaStream;
    const devices = [{ deviceId: "rear-1", kind: "videoinput", label: "Back Camera" }] as MediaDeviceInfo[];
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(firstStream)
      .mockRejectedValueOnce(new DOMException("stale", "OverconstrainedError"))
      .mockResolvedValueOnce(fallbackStream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue(devices) } });
    const { result, unmount } = renderHook(() => useCameraController());
    await act(async () => { expect(await result.current.start()).toBe(true); });
    await act(async () => { expect(await result.current.switchCamera("stale-camera")).toBe(true); });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: false, video: { deviceId: { exact: "stale-camera" } } });
    expect(getUserMedia).toHaveBeenNthCalledWith(3, { audio: false, video: { facingMode: { exact: "environment" } } });
    expect(result.current.stream).toBe(fallbackStream);
    expect(result.current.selectedDeviceId).toBe("rear-1");
    unmount();
  });

  it("shows the active camera and offers a direct Safari preview gesture", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValueOnce(new DOMException("gesture", "NotAllowedError"))
      .mockResolvedValueOnce();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const track = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const stream = { getVideoTracks: () => [track] } as unknown as MediaStream;
    const devices = [
      { deviceId: "rear-1", kind: "videoinput", label: "Back Camera" },
      { deviceId: "front-1", kind: "videoinput", label: "Front Camera" },
    ] as MediaDeviceInfo[];
    const onSwitchCamera = vi.fn();
    const onPlaybackProblem = vi.fn();
    const onPlaybackRecovered = vi.fn();
    const { unmount } = render(<CameraCapture
      stream={stream}
      devices={devices}
      selectedDeviceId="rear-1"
      problem={null}
      busy={false}
      captureKey="F"
      autoEnabled={false}
      onAutoChange={vi.fn()}
      onCapture={vi.fn()}
      onSwitchCamera={onSwitchCamera}
      onRecover={vi.fn()}
      onPlaybackProblem={onPlaybackProblem}
      onPlaybackRecovered={onPlaybackRecovered}
    />);
    expect(screen.getByLabelText("Camera")).toHaveValue("rear-1");
    fireEvent.change(screen.getByLabelText("Camera"), { target: { value: "front-1" } });
    expect(onSwitchCamera).toHaveBeenCalledWith("front-1");
    const resume = await screen.findByRole("button", { name: "Show camera preview" });
    expect(onPlaybackProblem).toHaveBeenCalledWith("Safari paused the preview. Tap Show camera preview to resume.");
    Object.defineProperty(screen.getByLabelText("Live camera preview"), "videoWidth", { configurable: true, value: 640 });
    Object.defineProperty(screen.getByLabelText("Live camera preview"), "videoHeight", { configurable: true, value: 480 });
    fireEvent.click(resume);
    await waitFor(() => expect(onPlaybackRecovered).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Show camera preview" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Tap to show camera" })).not.toBeInTheDocument();
    unmount();
    expect(pause).toHaveBeenCalled();
    play.mockRestore();
    pause.mockRestore();
  });
});
