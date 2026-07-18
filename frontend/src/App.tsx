import { useReducer } from "react";
import { api } from "./api/client";
import { CameraCapture } from "./camera/CameraCapture";
import { useCameraController } from "./camera/useCameraController";
import { CubeNetEditor } from "./cube/CubeNetEditor";
import { DEMO_FACELETS, SOLVED_FACELETS } from "./cube/cube";
import { faceletsAtProgress, faceletsBeforeMove, inverseMove } from "./guidance/guidance";
import { SolutionGuide } from "./guidance/SolutionGuide";
import { SCAN_ORDER, type Face, type Facelets, type SolveResponse, type UploadResponse, type ValidationResponse } from "./types";

type Screen = "welcome" | "permission" | "scan" | "verify" | "solution" | "solved";
type GuidanceMode = "solve" | "undo" | "restart";
interface PendingCapture { result: UploadResponse; blob: Blob }
interface State {
  screen: Screen;
  sessionId: string | null;
  scanIndex: number;
  retakeFace: Face | null;
  facelets: Facelets | null;
  confidence: Record<Face, number[]> | null;
  validation: ValidationResponse | null;
  solution: SolveResponse | null;
  moveIndex: number;
  guidanceMode: GuidanceMode;
  restartCursor: number;
  guidanceReady: boolean;
  cameraFree: boolean;
  autoCapture: boolean;
  busy: boolean;
  error: string | null;
  warnings: string[];
  pendingCapture: PendingCapture | null;
  hasScans: boolean;
}
type Action = { type: "patch"; value: Partial<State> } | { type: "reset" };
const initialState: State = {
  screen: "welcome", sessionId: null, scanIndex: 0, retakeFace: null,
  facelets: null, confidence: null, validation: null, solution: null,
  moveIndex: 0, guidanceMode: "solve", restartCursor: 0, guidanceReady: false,
  cameraFree: false, autoCapture: true, busy: false, error: null, warnings: [],
  pendingCapture: null, hasScans: false,
};
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
  const camera = useCameraController();
  const patch = (value: Partial<State>) => dispatch({ type: "patch", value });

  function fail(error: unknown) { patch({ busy: false, error: error instanceof Error ? error.message : "Something went wrong." }); }

  async function begin(screen: "permission" | "verify", faces?: Facelets, cameraFree = false) {
    patch({ busy: true, error: null });
    try {
      const session = await api.createSession();
      if (faces) {
        const validation = await api.updateFacelets(session.sessionId, faces);
        patch({ sessionId: session.sessionId, screen, facelets: faces, confidence: null, validation, busy: false, hasScans: false, cameraFree });
      } else patch({ sessionId: session.sessionId, screen, busy: false, cameraFree });
    } catch (error) { fail(error); }
  }

  async function requestCamera(deviceId?: string) {
    patch({ busy: true, error: null });
    const started = await camera.start(deviceId);
    patch(started ? { screen: "scan", busy: false, cameraFree: false } : { busy: false });
  }

  function acceptCapture(result: UploadResponse) {
    if (!result.committed) return;
    if (state.retakeFace) {
      if (!result.facelets) {
        patch({ error: "This session still needs all six faces. Continue scanning the missing faces.", retakeFace: null, scanIndex: 0, pendingCapture: null });
        return;
      }
      camera.stop();
      patch({ screen: "verify", facelets: result.facelets, confidence: result.confidence, retakeFace: null, pendingCapture: null, warnings: [], validation: null });
    } else if (state.scanIndex === SCAN_ORDER.length - 1 && result.facelets) {
      camera.stop();
      patch({ screen: "verify", facelets: result.facelets, confidence: result.confidence, pendingCapture: null, warnings: [], validation: null, hasScans: true });
    } else patch({ scanIndex: state.scanIndex + 1, pendingCapture: null, warnings: [] });
  }

  async function uploadCapture(blob: Blob) {
    if (!state.sessionId) return;
    const face = state.retakeFace ?? SCAN_ORDER[state.scanIndex];
    patch({ busy: true, error: null, warnings: [], pendingCapture: null });
    try {
      const result = await api.uploadFace(state.sessionId, face, blob, "if_acceptable");
      if (result.committed) {
        patch({ busy: false, warnings: result.quality.warnings });
        acceptCapture(result);
      } else {
        patch({ busy: false, warnings: [...result.quality.warnings, result.readinessMessage], pendingCapture: { result, blob } });
      }
    } catch (error) { fail(error); }
  }

  async function forcePendingCapture() {
    if (!state.sessionId || !state.pendingCapture) return;
    patch({ busy: true, error: null });
    try {
      const result = await api.uploadFace(state.sessionId, state.pendingCapture.result.face, state.pendingCapture.blob, "always");
      patch({ busy: false });
      acceptCapture(result);
    } catch (error) { fail(error); }
  }

  async function validateAndSolve() {
    if (!state.sessionId || !state.facelets) return;
    patch({ busy: true, error: null, validation: null });
    try {
      const validation = await api.updateFacelets(state.sessionId, state.facelets);
      if (!validation.valid) { patch({ validation, busy: false }); return; }
      const solution = await api.solve(state.sessionId);
      patch({ validation, solution, busy: false, moveIndex: 0, guidanceMode: "solve", guidanceReady: state.cameraFree, screen: solution.moveCount ? "solution" : "solved" });
    } catch (error) { fail(error); }
  }

  async function resetFlow() {
    camera.stop();
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
    if (next >= state.solution.moves.length) camera.stop();
    patch(next >= state.solution.moves.length ? { moveIndex: next, screen: "solved" } : { moveIndex: next });
  }

  const solutionMove = (() => {
    if (!state.solution) return null;
    if (state.guidanceMode === "solve") return state.solution.moves[state.moveIndex] ?? null;
    const index = state.guidanceMode === "restart" ? state.restartCursor - 1 : state.moveIndex - 1;
    return inverseMove(state.solution.moves[index], faceletsBeforeMove(state.solution.moves, state.solution.initialFacelets, index));
  })();
  const guidanceFacelets = state.solution
    ? faceletsAtProgress(state.solution.moves, state.solution.initialFacelets, state.guidanceMode === "restart" ? state.restartCursor : state.moveIndex)
    : null;
  const scanFace = state.retakeFace ?? SCAN_ORDER[state.scanIndex];

  return <><header className="topbar"><button className="brand" onClick={() => void resetFlow()}><span className="brand-mark">R²</span><span>Rubik's 2×2<br /><small>Camera Solver</small></span></button><span className="local-badge">Local only</span></header>
    <main>
      {state.error && <div className="alert error global" role="alert">{state.error}<button aria-label="Dismiss error" onClick={() => patch({ error: null })}>×</button></div>}
      {state.screen === "welcome" && <section className="hero"><div className="hero-copy"><span className="eyebrow">Shortest solution · HTM</span><h1>Scan your 2×2.<br />Turn it solved.</h1><p>Hold each face inside the guide. Stable, well-lit faces capture automatically, and every accepted image stays local.</p><div className="hero-actions"><button className="primary large" disabled={state.busy} onClick={() => void begin("permission")}>Start scanning</button><button disabled={state.busy} onClick={() => void begin("verify", DEMO_FACELETS, true)}>Try demo without camera</button><button disabled={state.busy} onClick={() => void begin("verify", SOLVED_FACELETS, true)}>Enter manually</button></div><ul className="feature-list"><li>Automatic guided capture</li><li>Physically valid cube checks</li><li>Optimal 2×2 solution</li></ul></div><div className="hero-cube" aria-hidden="true"><div className="cube-art"><i /><i /><i /></div><p>6 faces · 24 facelets · one exact state</p></div></section>}
      {state.screen === "permission" && <section className="center-card panel"><span className="eyebrow">Camera setup</span><h1>Allow camera access</h1><p>Tap below to start Safari's rear camera. Only the square face snapshot is sent to the local backend, then discarded.</p>{camera.problem && <div className="alert error" role="alert">{camera.problem.message}</div>}<button className="primary large" disabled={state.busy || camera.starting} onClick={() => void requestCamera()}>{state.busy || camera.starting ? "Requesting…" : state.retakeFace ? "Start camera to retake" : "Allow camera"}</button><button onClick={() => patch({ screen: "scan", cameraFree: true })}>Use image files instead</button><p className="privacy-note">Rear camera is preferred. Permission begins only from this button.</p></section>}
      {state.screen === "scan" && <section className="scan-layout"><div className="scan-copy panel"><span className="eyebrow">{state.retakeFace ? "Retake face" : `Face ${state.scanIndex + 1} of 6`}</span><h1>{scanFace} · {faceName(scanFace)}</h1><p>{SCAN_INSTRUCTIONS[scanFace]}</p><div className="scan-progress" aria-label={`${state.scanIndex} faces captured`}>{SCAN_ORDER.map((face, index) => <span key={face} className={index < state.scanIndex ? "done" : face === scanFace ? "current" : ""}>{face}</span>)}</div><details><summary>Orientation details</summary><p>Rotate the whole cube only. Never turn a layer while scanning.</p></details>{state.scanIndex > 0 && !state.retakeFace && <p className="previous-face">Previously accepted: {SCAN_ORDER[state.scanIndex - 1]}</p>}</div><div><CameraCapture stream={camera.stream} devices={camera.devices} problem={camera.problem} busy={state.busy} captureKey={scanFace} autoEnabled={state.autoCapture} onAutoChange={(autoCapture) => patch({ autoCapture })} onCapture={(blob) => void uploadCapture(blob)} onSwitchCamera={(id) => void requestCamera(id)} onRecover={() => void requestCamera()} onPlaybackProblem={camera.reportPlaybackProblem} />{state.warnings.length > 0 && <div className="alert warning"><ul>{state.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>{state.pendingCapture && <button disabled={state.busy} onClick={() => void forcePendingCapture()}>Use this capture anyway</button>}</div>}</div></section>}
      {state.screen === "verify" && state.facelets && <CubeNetEditor facelets={state.facelets} confidence={state.confidence} validation={state.validation} canRetake={state.hasScans} busy={state.busy} onChange={(facelets) => patch({ facelets, validation: null })} onRetake={(face) => patch({ screen: "permission", retakeFace: face, warnings: [] })} onSolve={() => void validateAndSolve()} />}
      {state.screen === "solution" && state.solution && solutionMove && guidanceFacelets && <SolutionGuide solution={state.solution} move={solutionMove} facelets={guidanceFacelets} completed={state.guidanceMode === "restart" ? state.restartCursor : state.moveIndex} mode={state.guidanceMode} stream={camera.stream} cameraStarting={camera.starting} cameraProblem={camera.problem} guidanceReady={state.guidanceReady} onStartCamera={() => void camera.start()} onOrientationMatched={() => patch({ guidanceReady: true })} onContinueWithoutCamera={() => { camera.stop(); patch({ guidanceReady: true, cameraFree: true }); }} onPlaybackProblem={camera.reportPlaybackProblem} onDone={completeGuidanceStep} onPrevious={() => patch({ guidanceMode: "undo" })} onRestart={() => state.moveIndex > 0 && patch({ guidanceMode: "restart", restartCursor: state.moveIndex })} onRescan={() => void resetFlow()} />}
      {state.screen === "solved" && <section className="center-card panel solved"><div className="success-mark">✓</div><span className="eyebrow">Complete</span><h1>Cube solved</h1><p>{state.solution?.moveCount ?? 0} optimal HTM moves. Nice work.</p><button className="primary large" onClick={() => void resetFlow()}>Solve another cube</button></section>}
    </main><footer><span>No accounts. No cloud. No telemetry.</span><a href="/api/health" target="_blank" rel="noreferrer">API health</a></footer></>;
}

function faceName(face: Face) { return ({ F: "Front", R: "Right", B: "Back", L: "Left", U: "Up", D: "Down" } as const)[face]; }
