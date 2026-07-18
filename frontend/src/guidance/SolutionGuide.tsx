import type { CubeMove, SolveResponse } from "../types";
import { ArrowOverlay } from "./ArrowOverlay";

interface Props {
  solution: SolveResponse;
  move: CubeMove;
  completed: number;
  mode: "solve" | "undo" | "restart";
  onDone: () => void;
  onPrevious: () => void;
  onRestart: () => void;
  onRescan: () => void;
}

export function SolutionGuide({ solution, move, completed, mode, onDone, onPrevious, onRestart, onRescan }: Props) {
  return <section className="solution-layout">
    <div className="solution-camera panel">
      <div className="solution-video"><div className="camera-placeholder guidance-bg">Position the cube so Front, Up, and Right match the guide.</div><ArrowOverlay move={move} /></div>
      <p className="privacy-note">This is a fixed placement overlay. The MVP does not track hands or turns automatically.</p>
    </div>
    <div className="move-card panel">
      <span className="eyebrow">{mode === "solve" ? `Move ${completed + 1} of ${solution.moveCount}` : mode === "undo" ? "Undo previous move" : "Returning to the start"}</span>
      <div className="notation">{move.notation}</div><h1>{move.description}</h1>
      <p>Clockwise is defined while looking directly at the highlighted face. Whole-cube positioning is not counted as a move.</p>
      <div className="progress" aria-label={`${completed} of ${solution.moveCount} moves complete`}><i style={{ width: `${solution.moveCount ? completed / solution.moveCount * 100 : 100}%` }} /></div>
      <div className="solution-actions"><button disabled={completed === 0 || mode !== "solve"} onClick={onPrevious}>Previous / Undo</button><button className="primary" onClick={onDone}>{mode === "solve" ? "Done / Next" : "Done undoing"}</button></div>
      <div className="text-actions"><button onClick={onRestart}>Restart safely</button><button onClick={onRescan}>Rescan</button></div>
    </div>
  </section>;
}

