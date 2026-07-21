import { act, render, screen } from "@testing-library/react";
import { SolvedCamera } from "../src/guidance/SolvedCamera";

describe("solved camera celebration", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  function setReducedMotion(matches: boolean) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches, media: "(prefers-reduced-motion: reduce)", addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  }

  it("keeps the live stream attached while removing every AR layer", () => {
    setReducedMotion(false);
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const view = render(<SolvedCamera stream={stream} moveCount={7} onPlaybackProblem={vi.fn()} onSolveAnother={vi.fn()} />);
    const video = screen.getByLabelText("Live solved cube camera") as HTMLVideoElement;
    expect(video.srcObject).toBe(stream);
    expect(document.querySelector(".guidance-overlay")).not.toBeInTheDocument();
    expect(document.querySelector(".active-face-wash")).not.toBeInTheDocument();
    expect(document.querySelector(".turn-arrow")).not.toBeInTheDocument();
    expect(stop).not.toHaveBeenCalled();
    view.unmount();
    expect(stop).not.toHaveBeenCalled();
  });

  it("places a compact success message inside the camera near an edge and cleans up confetti", () => {
    setReducedMotion(false);
    const view = render(<SolvedCamera stream={null} moveCount={5} onPlaybackProblem={vi.fn()} onSolveAnother={vi.fn()} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveClass("solved-banner");
    expect(banner.parentElement).toHaveClass("solution-video", "solved-video");
    expect(screen.getByRole("heading", { name: "Cube solved! 🎉" })).toBeVisible();
    expect(screen.getByText("5 moves", { exact: true })).toBeVisible();
    expect(screen.queryByText(/camera stays live/)).not.toBeInTheDocument();
    expect(document.querySelectorAll(".confetti-piece")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Solve another cube" })).toBeVisible();
    act(() => vi.advanceTimersByTime(1_500));
    expect(document.querySelector(".confetti")).not.toBeInTheDocument();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not create confetti or an animation timer with reduced motion", () => {
    setReducedMotion(true);
    render(<SolvedCamera stream={null} moveCount={3} onPlaybackProblem={vi.fn()} onSolveAnother={vi.fn()} />);
    expect(document.querySelector(".confetti")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });
});
