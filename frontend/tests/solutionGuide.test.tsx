import { act, fireEvent, render, screen } from "@testing-library/react";
import { SOLVED_FACELETS } from "../src/cube/cube";
import { SolutionGuide } from "../src/guidance/SolutionGuide";
import type { CubeMove, SolveResponse } from "../src/types";

function cubeMove(notation: "U" | "R"): CubeMove {
  return {
    notation,
    face: notation,
    quarterTurns: 1,
    clockwise: true,
    description: `Turn ${notation} clockwise`,
    overlay: { visibleFace: notation, surface: notation.toLowerCase(), direction: "clockwise" },
    resultingFacelets: SOLVED_FACELETS,
  };
}

const moves = [cubeMove("U"), cubeMove("R")];
const solution: SolveResponse = {
  metric: "HTM",
  optimal: true,
  moveCount: moves.length,
  initialFacelets: SOLVED_FACELETS,
  targetFaceColors: { U: "white", R: "red", F: "green", D: "yellow", L: "orange", B: "blue" },
  moves,
};

function props(overrides: Partial<React.ComponentProps<typeof SolutionGuide>> = {}): React.ComponentProps<typeof SolutionGuide> {
  return {
    solution,
    move: moves[0],
    facelets: SOLVED_FACELETS,
    completed: 0,
    mode: "solve",
    stream: null,
    cameraStarting: false,
    cameraProblem: null,
    guidanceReady: true,
    onStartCamera: vi.fn(),
    onOrientationMatched: vi.fn(),
    onContinueWithoutCamera: vi.fn(),
    onPlaybackProblem: vi.fn(),
    onDone: vi.fn(),
    onPrevious: vi.fn(),
    onRestart: vi.fn(),
    onRescan: vi.fn(),
    ...overrides,
  };
}

describe("solution move progression", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("defaults to automatic mode and advances once after a visible three-second countdown", () => {
    const onDone = vi.fn();
    render(<SolutionGuide {...props({ onDone })} />);
    expect(screen.getByRole("button", { name: "Auto advance" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Next move in 3");
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole("status")).toHaveTextContent("Next move in 2");
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole("status")).toHaveTextContent("Next move in 1");
    act(() => vi.advanceTimersByTime(1_000));
    expect(onDone).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("manual mode cancels the timer and switching back starts a fresh countdown", () => {
    const onDone = vi.fn();
    render(<SolutionGuide {...props({ onDone })} />);
    act(() => vi.advanceTimersByTime(2_000));
    fireEvent.click(screen.getByRole("button", { name: "Manual advance" }));
    expect(screen.getByRole("status")).toHaveTextContent("Manual advance");
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Auto advance" }));
    expect(screen.getByRole("status")).toHaveTextContent("Next move in 3");
    act(() => vi.advanceTimersByTime(2_999));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("resets to three seconds when Done / Next advances early", () => {
    const onDone = vi.fn();
    const first = props({ onDone });
    const view = render(<SolutionGuide {...first} />);
    act(() => vi.advanceTimersByTime(1_500));
    fireEvent.click(screen.getByRole("button", { name: "Done / Next" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    view.rerender(<SolutionGuide {...first} completed={1} move={moves[1]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Next move in 3");
    act(() => vi.advanceTimersByTime(2_999));
    expect(onDone).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("cancels automatic progression for Previous / Undo and Restart modes", () => {
    const onDone = vi.fn();
    const onPrevious = vi.fn();
    const onRestart = vi.fn();
    const base = props({ completed: 1, move: moves[1], onDone, onPrevious, onRestart });
    const view = render(<SolutionGuide {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous / Undo" }));
    expect(onPrevious).toHaveBeenCalledOnce();
    view.rerender(<SolutionGuide {...base} mode="undo" />);
    act(() => vi.advanceTimersByTime(5_000));
    expect(onDone).not.toHaveBeenCalled();
    view.rerender(<SolutionGuide {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart safely" }));
    expect(onRestart).toHaveBeenCalledOnce();
    view.rerender(<SolutionGuide {...base} mode="restart" />);
    act(() => vi.advanceTimersByTime(5_000));
    expect(onDone).not.toHaveBeenCalled();
  });

  it("cancels the timer on Rescan and unmount", () => {
    const onDone = vi.fn();
    const onRescan = vi.fn();
    const view = render(<SolutionGuide {...props({ onDone, onRescan })} />);
    expect(vi.getTimerCount()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Rescan" }));
    expect(onRescan).toHaveBeenCalledOnce();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(5_000));
    expect(onDone).not.toHaveBeenCalled();
  });

  it("pauses while the page is hidden and resumes without skipping", () => {
    let hidden = false;
    const originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    const onDone = vi.fn();
    render(<SolutionGuide {...props({ onDone })} />);
    act(() => vi.advanceTimersByTime(1_100));
    hidden = true;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDone).not.toHaveBeenCalled();
    hidden = false;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(1_899));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledOnce();
    if (originalHidden) Object.defineProperty(document, "hidden", originalHidden);
  });

  it("transitions the final move through the same single three-second callback", () => {
    const onDone = vi.fn();
    render(<SolutionGuide {...props({ completed: 1, move: moves[1], onDone })} />);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(3_000));
    expect(onDone).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
