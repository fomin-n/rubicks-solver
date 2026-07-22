import { useLayoutEffect, useReducer } from "react";
import { api } from "./api/client";
import { CameraCapture } from "./camera/CameraCapture";
import { CapturedFaces } from "./camera/CapturedFaces";
import { commitModeForCapture, type CaptureSource } from "./camera/capturePolicy";
import { useCameraController } from "./camera/useCameraController";
import { CubeNetEditor } from "./cube/CubeNetEditor";
import { DEMO_FACELETS, SOLVED_FACELETS } from "./cube/cube";
import { faceletsAtProgress, faceletsBeforeMove, inverseMove } from "./guidance/guidance";
import { SolvedCamera } from "./guidance/SolvedCamera";
import { SolutionGuide } from "./guidance/SolutionGuide";
import {
  SCAN_ORDER,
  type CapturedFacePreview,
  type Face,
  type Facelets,
  type ScanFace,
  type SolveResponse,
  type UploadResponse,
  type ValidationResponse,
} from "./types";

type Screen = "welcome" | "permission" | "scan" | "processing" | "recovery" | "verify" | "solution" | "solved";
type GuidanceMode = "solve" | "undo" | "restart";
interface CaptureNotice { code: string; message: string }
interface State {
  screen: Screen;
  sessionId: string | null;
  scanIndex: number;
  retakeFace: ScanFace | null;
  capturedFaces: Partial<Record<Face, CapturedFacePreview>>;
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
  notices: CaptureNotice[];
  captureFeedback: string | null;
}
type Action = { type: "patch"; value: Partial<State> } | { type: "reset" };
const initialState: State = {
  screen: "welcome", sessionId: null, scanIndex: 0, retakeFace: null, capturedFaces: {},
  facelets: null, confidence: null, validation: null, solution: null,
  moveIndex: 0, guidanceMode: "solve", restartCursor: 0, guidanceReady: false,
  cameraFree: false, autoCapture: true, busy: false, error: null, notices: [], captureFeedback: null,
};
function reducer(state: State, action: Action): State { return action.type === "reset" ? initialState : { ...state, ...action.value }; }

const SCAN_INSTRUCTIONS: Record<ScanFace, string> = {
  F: "Hold the cube straight on. This orientation becomes Front.",
  R: "Rotate the whole cube left once. Do not turn a layer.",
  B: "Rotate the whole cube left once more.",
  L: "Rotate the whole cube left once more.",
  U: "Return to Front, then tilt the whole cube downward to show Up.",
};

function captureNotices(result: UploadResponse): CaptureNotice[] {
  const notices = result.quality.warningCodes.map((code, index) => ({
    code,
    message: result.quality.warnings[index] ?? result.readinessMessage,
  }));
  if (!result.committed && !notices.some((notice) => notice.code === result.readinessCode)) {
    notices.push({ code: result.readinessCode, message: result.readinessMessage });
  }
  return notices;
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const camera = useCameraController();
  const patch = (value: Partial<State>) => dispatch({ type: "patch", value });

  useLayoutEffect(() => {
    const scanning = state.screen === "scan";
    document.documentElement.classList.toggle("scan-active", scanning);
    document.body.classList.toggle("scan-active", scanning);
    if (scanning) window.scrollTo(0, 0);
    return () => {
      document.documentElement.classList.remove("scan-active");
      document.body.classList.remove("scan-active");
    };
  }, [state.screen]);

  function fail(error: unknown) { patch({ busy: false, error: error instanceof Error ? error.message : "Something went wrong." }); }

  async function begin(screen: "permission" | "verify", faces?: Facelets, cameraFree = false) {
    patch({ busy: true, error: null });
    try {
      const session = await api.createSession();
      if (faces) {
        const validation = await api.updateFacelets(session.sessionId, faces);
        patch({ sessionId: session.sessionId, screen, facelets: faces, confidence: null, validation, busy: false, cameraFree, capturedFaces: {} });
      } else patch({ sessionId: session.sessionId, screen, busy: false, cameraFree, capturedFaces: session.capturedFaces });
    } catch (error) { fail(error); }
  }

  async function requestCamera(deviceId?: string) {
    patch({ busy: true, error: null });
    const started = await camera.start(deviceId);
    patch(started ? { screen: "scan", busy: false, cameraFree: false } : { busy: false });
  }

  async function processCompletedScan(
    sessionId: string,
    facelets: Facelets,
    confidence: Record<Face, number[]> | null,
    capturedFaces: Partial<Record<Face, CapturedFacePreview>>,
  ) {
    camera.stop();
    patch({ screen: "processing", busy: true, facelets, confidence, capturedFaces, retakeFace: null, validation: null, notices: [] });
    try {
      const validation = await api.validate(sessionId);
      if (!validation.valid) {
        patch({ screen: "recovery", validation, busy: false });
        return;
      }
      const solution = await api.solve(sessionId);
      patch({
        validation, solution, busy: false, moveIndex: 0, guidanceMode: "solve",
        guidanceReady: state.cameraFree, screen: solution.moveCount ? "solution" : "solved",
      });
    } catch (error) { fail(error); }
  }

  async function acceptCapture(result: UploadResponse) {
    if (!result.committed || !state.sessionId) return;
    const notices = captureNotices(result);
    const feedback = `${faceName(result.face)} captured`;
    if (result.scansComplete && result.facelets) {
      patch({ captureFeedback: feedback, notices });
      await processCompletedScan(state.sessionId, result.facelets, result.confidence, result.capturedFaces);
      return;
    }
    if (result.completionStatus === "none" || result.completionStatus === "ambiguous") {
      camera.stop();
      patch({
        screen: "recovery", busy: false, facelets: null, confidence: null,
        capturedFaces: result.capturedFaces, retakeFace: null, validation: result.validation,
        notices, captureFeedback: feedback,
      });
      return;
    }
    const nextFace = SCAN_ORDER.find((face) => !result.capturedFaces[face]) ?? SCAN_ORDER[0];
    patch({
      busy: false, capturedFaces: result.capturedFaces, retakeFace: null,
      scanIndex: SCAN_ORDER.indexOf(nextFace), notices, captureFeedback: feedback,
    });
  }

  async function uploadCapture(blob: Blob, source: CaptureSource) {
    if (!state.sessionId) return;
    const face = state.retakeFace ?? SCAN_ORDER[state.scanIndex];
    patch({ busy: true, error: null, notices: [], captureFeedback: null });
    try {
      const commitMode = commitModeForCapture(source);
      const result = await api.uploadFace(state.sessionId, face, blob, commitMode);
      if (result.committed) await acceptCapture(result);
      else patch({ busy: false, notices: captureNotices(result) });
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

  function startRetake(face: Face) {
    if (face === "D") return;
    patch({
      screen: state.screen === "scan" || state.cameraFree ? "scan" : "permission",
      retakeFace: face, notices: [], captureFeedback: null, error: null,
    });
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
  const capturedCount = SCAN_ORDER.filter((face) => state.capturedFaces[face]).length;
  const problemFaces = Array.from(new Set(state.validation?.errors.flatMap((issue) => issue.faces.length ? issue.faces : issue.face ? [issue.face] : []) ?? []));

  return <><header className="topbar"><button className="brand" onClick={() => void resetFlow()}><span className="brand-mark">R²</span><span>Rubik's 2×2<br /><small>Camera Solver</small></span></button></header>
    <main>
      {state.error && <div className="alert error global" role="alert">{state.error}<button aria-label="Dismiss error" onClick={() => patch({ error: null })}>×</button></div>}
      {state.screen === "welcome" && <section className="hero"><div className="hero-copy"><span className="eyebrow">Shortest solution</span><h1>Scan your 2×2.<br />Turn it solved.</h1><div className="hero-actions"><button className="primary large" disabled={state.busy} onClick={() => void begin("permission")}>Start scanning</button><button disabled={state.busy} onClick={() => void begin("verify", DEMO_FACELETS, true)}>Try demo without camera</button><button disabled={state.busy} onClick={() => void begin("verify", SOLVED_FACELETS, true)}>Enter manually</button></div></div><div className="hero-cube" aria-hidden="true"><div className="cube-art"><i /><i /><i /></div></div></section>}
      {state.screen === "permission" && <section className="center-card panel"><span className="eyebrow">Camera setup</span><h1>{state.retakeFace ? `Retake ${state.retakeFace}` : "Allow camera access"}</h1><p>Tap below to start Safari's rear camera.</p>{camera.problem && <div className="alert error" role="alert">{camera.problem.message}</div>}<button className="primary large" disabled={state.busy || camera.starting} onClick={() => void requestCamera()}>{state.busy || camera.starting ? "Requesting…" : state.retakeFace ? "Start camera to retake" : "Allow camera"}</button><button onClick={() => patch({ screen: "scan", cameraFree: true })}>Use image files instead</button></section>}
      {state.screen === "scan" && <section className="scan-layout"><div className="scan-copy panel"><div className="scan-heading"><div><span className="eyebrow">{state.retakeFace ? "Retaking captured face" : `Face ${capturedCount + 1} of 5`}</span><h1>{scanFace} · {faceName(scanFace)}</h1></div><p>{SCAN_INSTRUCTIONS[scanFace]}</p></div><div className="scan-progress" aria-label={`${capturedCount} faces captured`}>{SCAN_ORDER.map((face) => {
        const current = face === scanFace;
        const scanned = Boolean(state.capturedFaces[face]);
        return <span key={face} className={`${scanned ? "done" : "remaining"}${current ? " current" : ""}`} aria-current={current ? "step" : undefined}>{face}</span>;
      })}</div><div className={`scan-feedback-slot${state.notices.length ? " warning" : state.captureFeedback ? " success" : ""}`} role="status"><span>{state.notices[0]?.message ?? (state.captureFeedback ? `✓ ${state.captureFeedback}` : "Keep the full face inside the guide")}</span></div><details><summary>Orientation details</summary><p>Rotate the whole cube only. Never turn a layer while scanning.</p></details></div><div className="scan-camera-column"><CameraCapture stream={camera.stream} devices={camera.devices} selectedDeviceId={camera.selectedDeviceId} problem={camera.problem} busy={state.busy} captureKey={scanFace} autoEnabled={state.autoCapture} onAutoChange={(autoCapture) => patch({ autoCapture })} onCapture={(blob, source) => void uploadCapture(blob, source)} onSwitchCamera={(id) => void requestCamera(id)} onRecover={() => void requestCamera()} onPlaybackProblem={camera.reportPlaybackProblem} onPlaybackRecovered={camera.clearProblem} /><div className="scan-preview-dock"><CapturedFaces compact previews={state.capturedFaces} activeFace={state.retakeFace} busy={state.busy} onRetake={startRetake} /></div></div></section>}
      {state.screen === "processing" && <section className="center-card panel processing"><span className="processing-spinner" aria-hidden="true" /><span className="eyebrow">Final face calculated</span><h1>Checking cube…</h1><CapturedFaces compact showInferred readOnly previews={state.capturedFaces} busy onRetake={() => undefined} /></section>}
      {state.screen === "recovery" && <section className="recovery panel"><div className="section-heading"><div><span className="eyebrow">Scan needs attention</span><h1>Check the highlighted faces</h1></div><p>{state.facelets ? "Your other captures are preserved. Retake only a suspicious face, or open the detailed editor." : "Your five captures are preserved. Retake a highlighted face to calculate the final face again."}</p></div><div className="recovery-errors" role="alert"><ul>{state.validation?.errors.map((issue) => <li key={`${issue.code}-${issue.face ?? "cube"}`}>{issue.message}</li>)}</ul></div><CapturedFaces previews={state.capturedFaces} problemFaces={problemFaces} busy={state.busy} onRetake={startRetake} /><div className="recovery-actions"><button className="primary" onClick={() => problemFaces[0] && startRetake(problemFaces[0])} disabled={!problemFaces.length}>Retake likely face</button>{state.facelets && <button onClick={() => patch({ screen: "verify" })}>Advanced correction</button>}<button onClick={() => void resetFlow()}>Start over</button></div></section>}
      {state.screen === "verify" && state.facelets && <CubeNetEditor facelets={state.facelets} confidence={state.confidence} validation={state.validation} canRetake={capturedCount > 0} busy={state.busy} onChange={(facelets) => patch({ facelets, validation: null })} onRetake={startRetake} onSolve={() => void validateAndSolve()} />}
      {state.screen === "solution" && state.solution && solutionMove && guidanceFacelets && <SolutionGuide solution={state.solution} move={solutionMove} facelets={guidanceFacelets} completed={state.guidanceMode === "restart" ? state.restartCursor : state.moveIndex} mode={state.guidanceMode} stream={camera.stream} cameraStarting={camera.starting} cameraProblem={camera.problem} guidanceReady={state.guidanceReady} onStartCamera={() => void camera.start()} onOrientationMatched={() => patch({ guidanceReady: true })} onContinueWithoutCamera={() => { camera.stop(); patch({ guidanceReady: true, cameraFree: true }); }} onPlaybackProblem={camera.reportPlaybackProblem} onDone={completeGuidanceStep} onPrevious={() => patch({ guidanceMode: "undo" })} onRestart={() => state.moveIndex > 0 && patch({ guidanceMode: "restart", restartCursor: state.moveIndex })} onRescan={() => void resetFlow()} />}
      {state.screen === "solved" && <SolvedCamera stream={camera.stream} moveCount={state.solution?.moveCount ?? 0} onPlaybackProblem={camera.reportPlaybackProblem} onSolveAnother={() => void resetFlow()} />}
    </main></>;
}

function faceName(face: Face) { return ({ F: "Front", R: "Right", B: "Back", L: "Left", U: "Up", D: "Down" } as const)[face]; }
