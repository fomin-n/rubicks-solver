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
  warningMinBrightness: 55,
  hardMinBrightness: 22,
  maxBrightness: 220,
  warningMaxDarkFraction: 0.25,
  hardMaxDarkFraction: 0.75,
  maxGlareFraction: 0.08,
  minSharpness: 12,
  minAlignment: 0.55,
} as const;

export interface CaptureMetrics {
  fullCropBrightness: number;
  fullCropDarkFraction: number;
  brightness: number;
  lowerBrightnessPercentile: number;
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
  | "low_light"
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
  blockingReason: ReadinessCode | null;
  warnings: ReadinessCode[];
  countsTowardHold: boolean;
  progress: number;
}

export interface CaptureEvaluation {
  acceptable: boolean;
  blockingReason: ReadinessCode | null;
  warnings: ReadinessCode[];
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
  blockingReason: null,
  warnings: [],
  countsTowardHold: false,
  progress: 0,
};

export const READINESS_MESSAGES: Record<ReadinessCode, string> = {
  warming_up: "Checking the camera…",
  too_dark: "Too dark — add diffuse light",
  low_light: "Low light, but usable — hold steady",
  reduce_glare: "Reduce glare or tilt the cube slightly",
  move_closer: "Move closer and keep the face sharp",
  center_cube: "Center one face inside the guide",
  hold_steady: "Hold steady",
  almost_ready: "Almost ready…",
  capturing: "Capturing…",
  move_to_next_face: "Move to the next face",
};

export function evaluateMetrics(metrics: CaptureMetrics): CaptureEvaluation {
  const warnings: ReadinessCode[] = [];
  if (
    metrics.brightness < AUTO_CAPTURE_CONFIG.warningMinBrightness ||
    metrics.darkFraction > AUTO_CAPTURE_CONFIG.warningMaxDarkFraction
  ) warnings.push("low_light");
  if (
    metrics.brightness < AUTO_CAPTURE_CONFIG.hardMinBrightness ||
    metrics.darkFraction > AUTO_CAPTURE_CONFIG.hardMaxDarkFraction
  ) return { acceptable: false, blockingReason: "too_dark", warnings };
  if (
    metrics.brightness > AUTO_CAPTURE_CONFIG.maxBrightness ||
    metrics.glareFraction > AUTO_CAPTURE_CONFIG.maxGlareFraction
  ) return { acceptable: false, blockingReason: "reduce_glare", warnings };
  if (metrics.sharpness < AUTO_CAPTURE_CONFIG.minSharpness) {
    return { acceptable: false, blockingReason: "move_closer", warnings };
  }
  if (metrics.alignmentScore < AUTO_CAPTURE_CONFIG.minAlignment) {
    return { acceptable: false, blockingReason: "center_cube", warnings };
  }
  if (metrics.motion > AUTO_CAPTURE_CONFIG.stableMotion) {
    return { acceptable: false, blockingReason: "hold_steady", warnings };
  }
  return { acceptable: true, blockingReason: null, warnings };
}

export function advanceAutoCapture(
  state: AutoCaptureState,
  metrics: CaptureMetrics,
  now: number,
): AutoCaptureResult {
  if (state.phase === "cooldown") {
    if (state.capturedAt !== null && now - state.capturedAt >= AUTO_CAPTURE_CONFIG.cooldownMs) {
      return {
        state: {
          ...state,
          phase: "scene_change",
          status: "move_to_next_face",
          blockingReason: null,
          warnings: [],
          countsTowardHold: false,
          progress: 0,
        },
        shouldCapture: false,
      };
    }
    return { state, shouldCapture: false };
  }
  if (state.phase === "scene_change") {
    if (metrics.motion >= AUTO_CAPTURE_CONFIG.sceneChangeMotion) {
      return { state: { ...INITIAL_AUTO_CAPTURE_STATE }, shouldCapture: false };
    }
    return { state, shouldCapture: false };
  }

  const evaluation = evaluateMetrics(metrics);
  if (!evaluation.acceptable) {
    const keepOneMiss = state.phase === "holding" && metrics.motion <= AUTO_CAPTURE_CONFIG.resetMotion;
    const history = [...state.history, false].slice(-AUTO_CAPTURE_CONFIG.historySize);
    return {
      state: {
        ...state,
        phase: keepOneMiss ? "holding" : "warming",
        history: keepOneMiss ? history : [],
        holdStartedAt: keepOneMiss ? state.holdStartedAt : null,
        status: evaluation.blockingReason ?? "warming_up",
        blockingReason: evaluation.blockingReason,
        warnings: evaluation.warnings,
        countsTowardHold: false,
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
  const status: ReadinessCode = evaluation.warnings.includes("low_light") && progress < 0.75
    ? "low_light"
    : "almost_ready";
  return {
    state: shouldCapture
      ? {
          phase: "cooldown", history, holdStartedAt, capturedAt: now, status: "capturing",
          blockingReason: null, warnings: evaluation.warnings, countsTowardHold: true, progress: 1,
        }
      : {
          phase: "holding", history, holdStartedAt, capturedAt: null, status,
          blockingReason: null, warnings: evaluation.warnings, countsTowardHold: true, progress,
        },
    shouldCapture,
  };
}

export function resetAutoCapture(): AutoCaptureState {
  return { ...INITIAL_AUTO_CAPTURE_STATE };
}
