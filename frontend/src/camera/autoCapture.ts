export const AUTO_CAPTURE_CONFIG = {
  analysisSize: 240,
  intervalMs: 100,
  holdMs: 900,
  historySize: 10,
  requiredAcceptable: 8,
  stableMotion: 3.2,
  resetMotion: 6,
  sceneChangeMotion: 8,
  cooldownMs: 800,
  minBrightness: 55,
  maxBrightness: 220,
  maxDarkFraction: 0.25,
  maxGlareFraction: 0.08,
  minSharpness: 12,
  minAlignment: 0.55,
} as const;

export interface CaptureMetrics {
  brightness: number;
  darkFraction: number;
  glareFraction: number;
  sharpness: number;
  motion: number;
  quadrantConsistency: number;
  boundaryStrength: number;
  alignmentScore: number;
}

export type ReadinessCode =
  | "warming_up"
  | "too_dark"
  | "reduce_glare"
  | "move_closer"
  | "center_cube"
  | "hold_steady"
  | "almost_ready"
  | "capturing"
  | "move_to_next_face";

export interface AutoCaptureState {
  phase: "warming" | "holding" | "cooldown" | "scene_change";
  history: boolean[];
  holdStartedAt: number | null;
  capturedAt: number | null;
  status: ReadinessCode;
  progress: number;
}

export interface AutoCaptureResult {
  state: AutoCaptureState;
  shouldCapture: boolean;
}

export const INITIAL_AUTO_CAPTURE_STATE: AutoCaptureState = {
  phase: "warming",
  history: [],
  holdStartedAt: null,
  capturedAt: null,
  status: "warming_up",
  progress: 0,
};

export const READINESS_MESSAGES: Record<ReadinessCode, string> = {
  warming_up: "Checking the camera…",
  too_dark: "Too dark — add diffuse light",
  reduce_glare: "Reduce glare or tilt the cube slightly",
  move_closer: "Move closer and keep the face sharp",
  center_cube: "Center one face inside the guide",
  hold_steady: "Hold steady",
  almost_ready: "Almost ready…",
  capturing: "Capturing…",
  move_to_next_face: "Move to the next face",
};

export function evaluateMetrics(metrics: CaptureMetrics): ReadinessCode | "acceptable" {
  if (
    metrics.brightness < AUTO_CAPTURE_CONFIG.minBrightness ||
    metrics.darkFraction > AUTO_CAPTURE_CONFIG.maxDarkFraction
  ) return "too_dark";
  if (
    metrics.brightness > AUTO_CAPTURE_CONFIG.maxBrightness ||
    metrics.glareFraction > AUTO_CAPTURE_CONFIG.maxGlareFraction
  ) return "reduce_glare";
  if (metrics.sharpness < AUTO_CAPTURE_CONFIG.minSharpness) return "move_closer";
  if (metrics.alignmentScore < AUTO_CAPTURE_CONFIG.minAlignment) return "center_cube";
  if (metrics.motion > AUTO_CAPTURE_CONFIG.stableMotion) return "hold_steady";
  return "acceptable";
}

export function advanceAutoCapture(
  state: AutoCaptureState,
  metrics: CaptureMetrics,
  now: number,
): AutoCaptureResult {
  if (state.phase === "cooldown") {
    if (state.capturedAt !== null && now - state.capturedAt >= AUTO_CAPTURE_CONFIG.cooldownMs) {
      return { state: { ...state, phase: "scene_change", status: "move_to_next_face", progress: 0 }, shouldCapture: false };
    }
    return { state, shouldCapture: false };
  }
  if (state.phase === "scene_change") {
    if (metrics.motion >= AUTO_CAPTURE_CONFIG.sceneChangeMotion) {
      return { state: { ...INITIAL_AUTO_CAPTURE_STATE }, shouldCapture: false };
    }
    return { state, shouldCapture: false };
  }

  const readiness = evaluateMetrics(metrics);
  if (readiness !== "acceptable") {
    const keepOneMiss = state.phase === "holding" && metrics.motion <= AUTO_CAPTURE_CONFIG.resetMotion;
    const history = [...state.history, false].slice(-AUTO_CAPTURE_CONFIG.historySize);
    return {
      state: {
        ...state,
        phase: keepOneMiss ? "holding" : "warming",
        history: keepOneMiss ? history : [],
        holdStartedAt: keepOneMiss ? state.holdStartedAt : null,
        status: readiness,
        progress: keepOneMiss ? state.progress : 0,
      },
      shouldCapture: false,
    };
  }

  const history = [...state.history, true].slice(-AUTO_CAPTURE_CONFIG.historySize);
  const holdStartedAt = state.holdStartedAt ?? now;
  const acceptableCount = history.filter(Boolean).length;
  const elapsed = now - holdStartedAt;
  const progress = Math.min(1, Math.min(elapsed / AUTO_CAPTURE_CONFIG.holdMs, acceptableCount / AUTO_CAPTURE_CONFIG.requiredAcceptable));
  const shouldCapture = elapsed >= AUTO_CAPTURE_CONFIG.holdMs && acceptableCount >= AUTO_CAPTURE_CONFIG.requiredAcceptable;
  return {
    state: shouldCapture
      ? { phase: "cooldown", history, holdStartedAt, capturedAt: now, status: "capturing", progress: 1 }
      : { phase: "holding", history, holdStartedAt, capturedAt: null, status: "almost_ready", progress },
    shouldCapture,
  };
}

export function resetAutoCapture(): AutoCaptureState {
  return { ...INITIAL_AUTO_CAPTURE_STATE };
}
