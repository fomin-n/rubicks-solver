import { useEffect, useRef, useState } from "react";
import type { CameraProblem } from "../camera/useCameraController";
import type { CubeMove, Facelets, SolveResponse } from "../types";
import { ArrowOverlay } from "./ArrowOverlay";

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
  const { stream, onPlaybackProblem } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    let cancelled = false;
    const play = async () => {
      try { await video.play(); }
      catch { if (!cancelled) onPlaybackProblem("Safari paused the guidance camera. Tap Start camera guidance again."); }
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) void play();
    else video.addEventListener("loadedmetadata", () => void play(), { once: true });
    return () => { cancelled = true; video.pause(); video.srcObject = null; };
  }, [stream, onPlaybackProblem]);

  const copyFormula = async () => {
    await navigator.clipboard?.writeText(props.solution.moves.map((item) => item.notation).join(" "));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return <section className="solution-layout">
    <div className="solution-camera panel">
      <div className="solution-video">
        {props.stream ? <video ref={videoRef} autoPlay muted playsInline className="camera-video" aria-label="Live solution camera" /> : <div className="camera-placeholder guidance-bg">Use the fixed guide without a camera, or start the live preview.</div>}
        <ArrowOverlay move={props.move} facelets={props.facelets} calibration={!props.guidanceReady} />
        {!props.guidanceReady && <div className="orientation-calibration"><strong>Match the colored U/F/R ghost</strong><span>Keep Front facing you, Up above, and Right on your right.</span></div>}
      </div>
      {!props.guidanceReady && <div className="guidance-start-actions">
        {props.cameraProblem && <p className="alert error">{props.cameraProblem.message}</p>}
        {!props.stream && <button className="primary" disabled={props.cameraStarting} onClick={props.onStartCamera}>{props.cameraStarting ? "Starting camera…" : "Start camera guidance"}</button>}
        {props.stream && <button className="primary" onClick={props.onOrientationMatched}>Orientation matched</button>}
        <button onClick={props.onContinueWithoutCamera}>Continue without camera</button>
      </div>}
      <p className="privacy-note">Colors show the current server-authoritative cube state. Turns are confirmed manually; hands and moves are not tracked.</p>
    </div>
    <div className="move-card panel">
      <div className="formula-header"><span className="eyebrow">Full solution · {props.solution.metric}</span><button onClick={() => void copyFormula()}>{copied ? "Copied" : "Copy formula"}</button></div>
      <ol className="formula" aria-label="Full solution formula">{props.solution.moves.map((item, index) => <li key={`${item.notation}-${index}`} className={index < props.completed ? "completed" : index === props.completed && props.mode === "solve" ? "current" : "remaining"}>{item.notation}</li>)}</ol>
      {!props.guidanceReady ? <div className="calibration-copy"><span className="eyebrow">Orientation setup</span><h1>Align the cube before move 1</h1><p>The colored ghost matches the cube state you scanned. This whole-cube positioning costs zero moves.</p></div> : <>
        <span className="eyebrow">{props.mode === "solve" ? `Move ${props.completed + 1} of ${props.solution.moveCount}` : props.mode === "undo" ? "Undo previous move" : `Returning to start · ${props.completed} remaining`}</span>
        <div className="notation">{props.move.notation}</div><h1>{props.move.description}</h1>
        <p>Clockwise is defined while looking directly at the highlighted face. Whole-cube positioning is not counted as a move.</p>
        <div className="progress" aria-label={`${props.completed} of ${props.solution.moveCount} moves complete`}><i style={{ width: `${props.solution.moveCount ? props.completed / props.solution.moveCount * 100 : 100}%` }} /></div>
        <div className="solution-actions"><button disabled={props.completed === 0 || props.mode !== "solve"} onClick={props.onPrevious}>Previous / Undo</button><button className="primary" onClick={props.onDone}>{props.mode === "solve" ? "Done / Next" : props.mode === "restart" ? "Done reversing" : "Done undoing"}</button></div>
        <div className="text-actions"><button disabled={props.completed === 0 || props.mode !== "solve"} onClick={props.onRestart}>Restart safely</button><button onClick={props.onRescan}>Rescan</button></div>
      </>}
    </div>
  </section>;
}
