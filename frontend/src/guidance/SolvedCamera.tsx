import { useEffect, useState, type CSSProperties } from "react";
import { LiveCameraVideo } from "./LiveCameraVideo";

const CONFETTI = [
  [8, -18, 0, "#71e6bd"], [15, 22, 90, "#f1d54c"], [23, -12, 180, "#e84255"],
  [31, 28, 270, "#3e88e9"], [40, -24, 45, "#f39b38"], [49, 18, 135, "#edf0e8"],
  [58, -20, 225, "#38bf83"], [67, 26, 315, "#f1d54c"], [76, -16, 60, "#e84255"],
  [84, 20, 150, "#3e88e9"], [92, -22, 240, "#f39b38"], [12, 16, 330, "#edf0e8"],
] as const;

interface Props {
  stream: MediaStream | null;
  moveCount: number;
  onPlaybackProblem: (message: string) => void;
  onSolveAnother: () => void;
}

export function SolvedCamera({ stream, moveCount, onPlaybackProblem, onSolveAnother }: Props) {
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reducedMotion) return;
    setShowConfetti(true);
    const timer = window.setTimeout(() => setShowConfetti(false), 1_500);
    return () => window.clearTimeout(timer);
  }, []);

  return <section className="solved-camera-layout" aria-label="Solved cube celebration">
    <div className="solution-camera solved-camera panel">
      <div className="solution-video solved-video">
        {stream
          ? <LiveCameraVideo stream={stream} label="Live solved cube camera" onPlaybackProblem={onPlaybackProblem} />
          : <div className="camera-placeholder guidance-bg" aria-hidden="true" />}
        {showConfetti && <div className="confetti" aria-hidden="true">{CONFETTI.map(([left, drift, rotation, color], index) => <i
          key={`${left}-${rotation}`}
          className="confetti-piece"
          style={{
            left: `${left}%`,
            "--confetti-drift": `${drift}px`,
            "--confetti-rotation": `${rotation}deg`,
            "--confetti-delay": `${index * 35}ms`,
            "--confetti-color": color,
          } as CSSProperties}
        />)}</div>}
        <div className="solved-banner" role="status">
          <h1>Cube solved! 🎉</h1>
          <span>{moveCount} moves</span>
        </div>
      </div>
      <div className="solved-camera-actions">
        <button className="primary large" onClick={onSolveAnother}>Solve another cube</button>
      </div>
    </div>
  </section>;
}
