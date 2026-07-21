import { useEffect, useRef, useState } from "react";
import type { CameraProblem } from "../camera/useCameraController";
import type { CubeMove, Facelets, SolveResponse } from "../types";
import { ArrowOverlay } from "./ArrowOverlay";
import { LiveCameraVideo } from "./LiveCameraVideo";

const AUTO_ADVANCE_MS = 3_000;
type AdvanceMode = "auto" | "manual";

interface Props {
  solution: SolveResponse;
  move: CubeMove;
  facelets: Facelets;
  completed: number;
  mode: "solve" | "undo" | "restart";
  stream: MediaStream | null;
  cameraStarting: boolean;
  cameraProblem: CameraProblem | null;
  guidanceReady: boolean;
  onStartCamera: () => void;
  onOrientationMatched: () => void;
  onContinueWithoutCamera: () => void;
  onPlaybackProblem: (message: string) => void;
  onDone: () => void;
  onPrevious: () => void;
  onRestart: () => void;
  onRescan: () => void;
}

export function SolutionGuide(props: Props) {
  const [copied, setCopied] = useState(false);
  const [advanceMode, setAdvanceMode] = useState<AdvanceMode>("auto");
  const [countdown, setCountdown] = useState<number | null>(null);
  const onDoneRef = useRef(props.onDone);
  onDoneRef.current = props.onDone;

  useEffect(() => {
    const active = advanceMode === "auto" && props.guidanceReady && props.mode === "solve";
    if (!active) {
      setCountdown(null);
      return;
    }

    let interval: number | null = null;
    let remaining = AUTO_ADVANCE_MS;
    let startedAt = Date.now();
    const clear = () => {
      if (interval !== null) window.clearInterval(interval);
      interval = null;
    };
    const pause = () => {
      if (interval === null) return;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
      clear();
      setCountdown(Math.max(1, Math.ceil(remaining / 1_000)));
    };
    const tick = () => {
      if (document.hidden) { pause(); return; }
      const nextRemaining = remaining - (Date.now() - startedAt);
      if (nextRemaining <= 0) {
        clear();
        setCountdown(null);
        onDoneRef.current();
        return;
      }
      setCountdown(Math.ceil(nextRemaining / 1_000));
    };
    const start = () => {
      if (document.hidden || interval !== null) return;
      startedAt = Date.now();
      interval = window.setInterval(tick, 100);
    };
    const onVisibilityChange = () => {
      if (document.hidden) pause();
      else start();
    };

    setCountdown(3);
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [advanceMode, props.completed, props.guidanceReady, props.mode, props.move.notation]);

  const copyFormula = async () => {
    await navigator.clipboard?.writeText(props.solution.moves.map((item) => item.notation).join(" "));
    setCopied(true);
  };

  return <section className="solution-layout">
    <div className="solution-camera panel">
      <div className="solution-video">
        {props.stream ? <LiveCameraVideo stream={props.stream} label="Live solution camera" onPlaybackProblem={props.onPlaybackProblem} /> : <div className="camera-placeholder guidance-bg">Position the cube to match the guide.</div>}
        <ArrowOverlay move={props.move} facelets={props.facelets} calibration={!props.guidanceReady} />
        {!props.guidanceReady && <div className="orientation-calibration"><strong>Match the colored U/F/R ghost</strong><span>Keep Front facing you, Up above, and Right on your right.</span></div>}
      </div>
      {!props.guidanceReady && <div className="guidance-start-actions">
        {props.cameraProblem && <p className="alert error">{props.cameraProblem.message}</p>}
        {!props.stream && <button className="primary" disabled={props.cameraStarting} onClick={props.onStartCamera}>{props.cameraStarting ? "Starting camera…" : "Start camera guidance"}</button>}
        {props.stream && <button className="primary" onClick={props.onOrientationMatched}>Orientation matched</button>}
        <button onClick={props.onContinueWithoutCamera}>Continue without camera</button>
      </div>}
    </div>
    <div className="move-card panel">
      <div className="formula-header"><span className="eyebrow">Full solution</span><button onClick={() => void copyFormula()}>{copied ? "Copied" : "Copy formula"}</button></div>
      <ol className="formula" aria-label="Full solution formula">{props.solution.moves.map((item, index) => <li key={`${item.notation}-${index}`} className={index < props.completed ? "completed" : index === props.completed && props.mode === "solve" ? "current" : "remaining"}>{item.notation}</li>)}</ol>
      {!props.guidanceReady ? <div className="calibration-copy"><span className="eyebrow">Orientation setup</span><h1>Align the cube before move 1</h1><p>The colored ghost matches the cube state you scanned. This whole-cube positioning costs zero moves.</p></div> : <>
        <span className="eyebrow">{props.mode === "solve" ? `Move ${props.completed + 1} of ${props.solution.moveCount}` : props.mode === "undo" ? "Undo previous move" : `Returning to start · ${props.completed} remaining`}</span>
        <div className="notation">{props.move.notation}</div><h1>{props.move.description}</h1>
        <p>Clockwise is defined while looking directly at the highlighted face. Whole-cube positioning is not counted as a move.</p>
        <div className="progress" aria-label={`${props.completed} of ${props.solution.moveCount} moves complete`}><i style={{ width: `${props.solution.moveCount ? props.completed / props.solution.moveCount * 100 : 100}%` }} /></div>
        <div className={`advance-status ${advanceMode}`} role="status">
          {advanceMode === "manual" ? "Manual advance · use Done / Next" : countdown !== null ? `Next move in ${countdown}` : "Auto advance paused"}
        </div>
        <div className="solution-actions"><button disabled={props.completed === 0 || props.mode !== "solve"} onClick={props.onPrevious}>Previous / Undo</button><button className="primary" onClick={props.onDone}>{props.mode === "solve" ? "Done / Next" : props.mode === "restart" ? "Done reversing" : "Done undoing"}</button></div>
        <div className="text-actions"><button disabled={props.completed === 0 || props.mode !== "solve"} onClick={props.onRestart}>Restart safely</button><button onClick={props.onRescan}>Rescan</button></div>
        <div className="advance-mode-control" role="group" aria-label="Move progression mode">
          <button type="button" aria-pressed={advanceMode === "auto"} onClick={() => setAdvanceMode("auto")}>Auto advance</button>
          <button type="button" aria-pressed={advanceMode === "manual"} onClick={() => setAdvanceMode("manual")}>Manual advance</button>
        </div>
      </>}
    </div>
  </section>;
}
