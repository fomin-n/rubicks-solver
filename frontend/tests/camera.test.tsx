import { act, renderHook } from "@testing-library/react";
import { cameraProblem, useCameraController } from "../src/camera/useCameraController";

const originalMediaDevices = navigator.mediaDevices;
afterEach(() => Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices }));

describe("camera controller", () => {
  it("maps browser failures to actionable errors", () => {
    expect(cameraProblem(new DOMException("blocked", "NotAllowedError")).code).toBe("permission_denied");
    expect(cameraProblem(new DOMException("busy", "NotReadableError")).code).toBe("in_use");
    expect(cameraProblem(new DOMException("missing", "NotFoundError")).code).toBe("not_found");
  });

  it("falls back from rear constraints and stops tracks on cleanup", async () => {
    const stop = vi.fn();
    const nextStop = vi.fn();
    const track = { stop, addEventListener: vi.fn(), readyState: "live" };
    const nextTrack = { stop: nextStop, addEventListener: vi.fn(), readyState: "live" };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    const nextStream = { getTracks: () => [nextTrack], getVideoTracks: () => [nextTrack] } as unknown as MediaStream;
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException("constraints", "OverconstrainedError"))
      .mockResolvedValueOnce(stream)
      .mockResolvedValueOnce(nextStream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]) } });
    const { result, unmount } = renderHook(() => useCameraController());
    await act(async () => { expect(await result.current.start()).toBe(true); });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(result.current.stream).toBe(stream);
    await act(async () => { expect(await result.current.switchCamera("rear-2")).toBe(true); });
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: false, video: { deviceId: { exact: "rear-2" } } });
    expect(stop).toHaveBeenCalledOnce();
    unmount();
    expect(nextStop).toHaveBeenCalledOnce();
  });
});
