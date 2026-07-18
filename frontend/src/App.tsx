import { useReducer, useState } from "react";
import { api } from "./api/client";
import { CameraCapture } from "./camera/CameraCapture";
import { CubeNetEditor } from "./cube/CubeNetEditor";
import { DEMO_FACELETS, SOLVED_FACELETS } from "./cube/cube";
import { faceletsBeforeMove, inverseMove } from "./guidance/guidance";
import { SolutionGuide } from "./guidance/SolutionGuide";
import { SCAN_ORDER, type Face, type Facelets, type SolveResponse, type UploadResponse, type ValidationResponse } from "./types";

type Screen = "welcome" | "permission" | "scan" | "verify" | "solution" | "solved";
type GuidanceMode = "solve" | "undo" | "restart";
interface State {
  screen: Screen; sessionId: string | null; scanIndex: number; retakeFace: Face | null;
  facelets: Facelets | null; confidence: Record<Face, number[]> | null; validation: ValidationResponse | null;
  solution: SolveResponse | null; moveIndex: number; guidanceMode: GuidanceMode; restartCursor: number;
  busy: boolean; error: string | null; warnings: string[]; pendingCapture: UploadResponse | null; hasScans: boolean;
}
type Action = { type: "patch"; value: Partial<State> } | { type: "reset" };
const initialState: State = { screen: "welcome", sessionId: null, scanIndex: 0, retakeFace: null, facelets: null, confidence: null, validation: null, solution: null, moveIndex: 0, guidanceMode: "solve", restartCursor: 0, busy: false, error: null, warnings: [], pendingCapture: null, hasScans: false };
function reducer(state: State, action: Action): State { return action.type === "reset" ? initialState : { ...state, ...action.value }; }

const SCAN_INSTRUCTIONS: Record<Face, string> = {
  F: "Hold the cube straight on. This orientation becomes Front.",
  R: "Rotate the whole cube left once. Do not turn a layer.",
  B: "Rotate the whole cube left once more.",
  L: "Rotate the whole cube left once more.",
  U: "Return to Front, then tilt the whole cube downward to show Up.",
  D: "Return to Front, then tilt the whole cube upward to show Down.",
};

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const patch = (value: Partial<State>) => dispatch({ type: "patch", value });

  function fail(error: unknown) { patch({ busy: false, error: error instanceof Error ? error.message : "Something went wrong." }); }
  function stopCamera() { stream?.getTracks().forEach((track) => track.stop()); setStream(null); }

  async function begin(screen: "permission" | "verify", faces?: Facelets) {
    patch({ busy: true, error: null });
    try {
      const session = await api.createSession();
      if (faces) {
        const validation = await api.updateFacelets(session.sessionId, faces);
        patch({ sessionId: session.sessionId, screen, facelets: faces, confidence: null, validation, busy: false, hasScans: false });
      } else patch({ sessionId: session.sessionId, screen, busy: false });
    } catch (error) { fail(error); }
  }

  async function requestCamera(deviceId?: string) {
    if (!navigator.mediaDevices?.getUserMedia) { patch({ error: "This browser does not support camera access. Use image files instead." }); return; }
    patch({ busy: true, error: null });
    try {
      stopCamera();
      const selected = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }, audio: false });
      setStream(selected); patch({ screen: "scan", busy: false });
    } catch { patch({ busy: false, error: "Camera permission was denied or no camera is available. You can retry or upload images." }); }
  }

  function acceptCapture(result: UploadResponse) {
    if (state.retakeFace) {
      if (!result.facelets) { patch({ error: "This manual session needs all six faces. Continue scanning the missing faces.", retakeFace: null, scanIndex: 0, pendingCapture: null }); return; }
      stopCamera(); patch({ screen: "verify", facelets: result.facelets, confidence: result.confidence, retakeFace: null, pendingCapture: null, warnings: [], validation: null });
    } else if (state.scanIndex === SCAN_ORDER.length - 1 && result.facelets) {
      stopCamera(); patch({ screen: "verify", facelets: result.facelets, confidence: result.confidence, pendingCapture: null, warnings: [], validation: null, hasScans: true });
    } else patch({ scanIndex: state.scanIndex + 1, pendingCapture: null, warnings: [] });
  }

  async function uploadCapture(blob: Blob) {
    if (!state.sessionId) return;
    const face = state.retakeFace ?? SCAN_ORDER[state.scanIndex];
    patch({ busy: true, error: null, warnings: [] });
    try {
      const result = await api.uploadFace(state.sessionId, face, blob);
      patch({ busy: false, warnings: result.quality.warnings });
      if (result.quality.retakeRecommended) patch({ pendingCapture: result }); else acceptCapture(result);
    } catch (error) { fail(error); }
  }

  async function validateAndSolve() {
    if (!state.sessionId || !state.facelets) return;
    patch({ busy: true, error: null, validation: null });
    try {
      const validation = await api.updateFacelets(state.sessionId, state.facelets);
      if (!validation.valid) { patch({ validation, busy: false }); return; }
      const solution = await api.solve(state.sessionId);
      patch({ validation, solution, busy: false, moveIndex: 0, guidanceMode: "solve", screen: solution.moveCount ? "solution" : "solved" });
    } catch (error) { fail(error); }
  }

  async function resetFlow() {
    stopCamera();
    if (state.sessionId) await api.deleteSession(state.sessionId).catch(() => undefined);
    dispatch({ type: "reset" });
  }

  function completeGuidanceStep() {
    if (!state.solution) return;
    if (state.guidanceMode === "undo") { patch({ moveIndex: state.moveIndex - 1, guidanceMode: "solve" }); return; }
    if (state.guidanceMode === "restart") {
      const next = state.restartCursor - 1;
      patch(next === 0 ? { restartCursor: 0, moveIndex: 0, guidanceMode: "solve" } : { restartCursor: next, moveIndex: next });
      return;
    }
    const next = state.moveIndex + 1;
    patch(next >= state.solution.moves.length ? { moveIndex: next, screen: "solved" } : { moveIndex: next });
  }

  const solutionMove = (() => {
    if (!state.solution) return null;
    if (state.guidanceMode === "solve") return state.solution.moves[state.moveIndex] ?? null;
    const index = state.guidanceMode === "restart" ? state.restartCursor - 1 : state.moveIndex - 1;
    return inverseMove(state.solution.moves[index], faceletsBeforeMove(state.solution.moves, state.solution.initialFacelets, index));
  })();

  return <><header className="topbar"><button className="brand" onClick={() => void resetFlow()}><span className="brand-mark">R²</span><span>Rubik's 2×2<br /><small>Camera Solver</small></span></button><span className="local-badge">Local only</span></header>
    <main>
      {state.error && <div className="alert error global" role="alert">{state.error}<button aria-label="Dismiss error" onClick={() => patch({ error: null })}>×</button></div>}
      {state.screen === "welcome" && <section className="hero"><div className="hero-copy"><span className="eyebrow">Shortest solution · HTM</span><h1>Scan your 2×2.<br />Turn it solved.</h1><p>Capture six aligned faces, correct any colors, and follow clear camera overlays. Images never leave this device.</p><div className="hero-actions"><button className="primary large" disabled={state.busy} onClick={() => void begin("permission")}>Start scanning</button><button disabled={state.busy} onClick={() => void begin("verify", DEMO_FACELETS)}>Try demo without camera</button><button disabled={state.busy} onClick={() => void begin("verify", SOLVED_FACELETS)}>Enter manually</button></div><ul className="feature-list"><li>Classical color recognition</li><li>Physically valid cube checks</li><li>Optimal 2×2 solution</li></ul></div><div className="hero-cube" aria-hidden="true"><div className="cube-art"><i /><i /><i /></div><p>6 faces · 24 facelets · one exact state</p></div></section>}
      {state.screen === "permission" && <section className="center-card panel"><span className="eyebrow">Step 1</span><h1>Allow camera access</h1><p>The browser camera runs on localhost. The backend receives only the square snapshot you capture and does not save it.</p><button className="primary large" disabled={state.busy} onClick={() => void requestCamera()}>{state.busy ? "Requesting…" : "Allow camera"}</button><button onClick={() => patch({ screen: "scan" })}>Use image files instead</button><p className="privacy-note">On mobile, the rear camera is preferred automatically.</p></section>}
      {state.screen === "scan" && <section className="scan-layout"><div className="scan-copy panel"><span className="eyebrow">Face {state.retakeFace ? "retake" : `${state.scanIndex + 1} of 6`}</span><h1>{state.retakeFace ?? SCAN_ORDER[state.scanIndex]} · {faceName(state.retakeFace ?? SCAN_ORDER[state.scanIndex])}</h1><p>{SCAN_INSTRUCTIONS[state.retakeFace ?? SCAN_ORDER[state.scanIndex]]}</p><div className="orientation-icon"><span>whole cube</span><b>↶</b><small>Never turn a layer while scanning.</small></div>{state.scanIndex > 0 && !state.retakeFace && <p className="previous-face">Previously scanned: {SCAN_ORDER[state.scanIndex - 1]}</p>}</div><div><CameraCapture stream={stream} busy={state.busy} onCapture={(blob) => void uploadCapture(blob)} onSwitchCamera={(id) => void requestCamera(id)} />{state.warnings.length > 0 && <div className="alert warning"><ul>{state.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>{state.pendingCapture && <button onClick={() => acceptCapture(state.pendingCapture!)}>Use this capture anyway</button>}</div>}</div></section>}
      {state.screen === "verify" && state.facelets && <CubeNetEditor facelets={state.facelets} confidence={state.confidence} validation={state.validation} canRetake={state.hasScans} busy={state.busy} onChange={(facelets) => patch({ facelets, validation: null })} onRetake={(face) => patch({ screen: "scan", retakeFace: face, warnings: [] })} onSolve={() => void validateAndSolve()} />}
      {state.screen === "solution" && state.solution && solutionMove && <SolutionGuide solution={state.solution} move={solutionMove} completed={state.moveIndex} mode={state.guidanceMode} onDone={completeGuidanceStep} onPrevious={() => patch({ guidanceMode: "undo" })} onRestart={() => state.moveIndex > 0 && patch({ guidanceMode: "restart", restartCursor: state.moveIndex })} onRescan={() => void resetFlow()} />}
      {state.screen === "solved" && <section className="center-card panel solved"><div className="success-mark">✓</div><span className="eyebrow">Complete</span><h1>Cube solved</h1><p>{state.solution?.moveCount ?? 0} optimal HTM moves. Nice work.</p><button className="primary large" onClick={() => void resetFlow()}>Solve another cube</button></section>}
    </main><footer><span>No accounts. No cloud. No telemetry.</span><a href="http://127.0.0.1:8000/docs" target="_blank" rel="noreferrer">API docs</a></footer></>;
}

function faceName(face: Face) { return ({ F: "Front", R: "Right", B: "Back", L: "Left", U: "Up", D: "Down" } as const)[face]; }

