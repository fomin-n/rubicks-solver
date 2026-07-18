export const AUTO_CAPTURE_CONFIG = {
  analysisSize: 240,
  intervalMs: 100,
  holdMs: 650,
  historySize: 6,
  requiredAcceptable: 5,
  stableMotion: 7,
  transientMotion: 12,
  resetMotion: 18,
  sustainedResetFrames: 3,
  sceneChangeMotion: 8,
  cooldownMs: 800,
  warningMinBrightness: 55,
  hardMinBrightness: 22,
  maxBrightness: 220,
  warningMaxDarkFraction: 0.25,
  hardMaxDarkFraction: 0.75,
  maxGlareFraction: 0.08,
  warningMinSharpness: 4,
  hardMinSharpness: 1.6,
  usableBoundaryStrength: 4,
  hardMinBoundaryStrength: 1.2,
  warningMinAlignment: 0.55,
  hardMinAlignment: 0.42,
  moveCloserAlignment: 0.32,
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
  | "soft_focus"
  | "too_blurry"
  | "slightly_off_center"
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
  motionHistory: number[];
  smoothedMotion: number;
  holdStartedAt: number | null;
  capturedAt: number | null;
  sceneChangedSinceCapture: boolean;
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
  motionHistory: [],
  smoothedMotion: 0,
  holdStartedAt: null,
  capturedAt: null,
  sceneChangedSinceCapture: false,
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
  soft_focus: "Slightly soft, but usable — hold steady",
  too_blurry: "Too blurred — hold the phone and cube steady",
  slightly_off_center: "Almost centered — hold this position",
  reduce_glare: "Reduce glare or tilt the cube slightly",
  move_closer: "Move closer and keep the face sharp",
  center_cube: "Center one face inside the guide",
  hold_steady: "Hold steady",
  almost_ready: "Almost ready…",
  capturing: "Capturing…",
  move_to_next_face: "Move to the next face",
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function evaluateMetrics(metrics: CaptureMetrics, motion = metrics.motion): CaptureEvaluation {
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

  const hasUsableDetail = metrics.sharpness >= AUTO_CAPTURE_CONFIG.warningMinSharpness
    || metrics.boundaryStrength >= AUTO_CAPTURE_CONFIG.usableBoundaryStrength;
  const severeBlur = metrics.sharpness < AUTO_CAPTURE_CONFIG.hardMinSharpness
    && metrics.boundaryStrength < AUTO_CAPTURE_CONFIG.hardMinBoundaryStrength;
  if (severeBlur) {
    return { acceptable: false, blockingReason: "too_blurry", warnings };
  }
  if (metrics.sharpness < AUTO_CAPTURE_CONFIG.warningMinSharpness) warnings.push("soft_focus");

  if (
    metrics.alignmentScore < AUTO_CAPTURE_CONFIG.moveCloserAlignment
    && !hasUsableDetail
  ) {
    return { acceptable: false, blockingReason: "move_closer", warnings };
  }
  if (metrics.alignmentScore < AUTO_CAPTURE_CONFIG.hardMinAlignment) {
    return { acceptable: false, blockingReason: "center_cube", warnings };
  }
  if (metrics.alignmentScore < AUTO_CAPTURE_CONFIG.warningMinAlignment) {
    warnings.push("slightly_off_center");
  }
  if (motion > AUTO_CAPTURE_CONFIG.stableMotion) {
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
    const sceneChangedSinceCapture = state.sceneChangedSinceCapture
      || metrics.motion >= AUTO_CAPTURE_CONFIG.sceneChangeMotion;
    if (state.capturedAt !== null && now - state.capturedAt >= AUTO_CAPTURE_CONFIG.cooldownMs) {
      if (sceneChangedSinceCapture) {
        return { state: { ...INITIAL_AUTO_CAPTURE_STATE }, shouldCapture: false };
      }
      return {
        state: {
          ...state,
          phase: "scene_change",
          status: "move_to_next_face",
          blockingReason: null,
          warnings: [],
          countsTowardHold: false,
          progress: 0,
          sceneChangedSinceCapture: false,
        },
        shouldCapture: false,
      };
    }
    return { state: { ...state, sceneChangedSinceCapture }, shouldCapture: false };
  }
  if (state.phase === "scene_change") {
    if (metrics.motion >= AUTO_CAPTURE_CONFIG.sceneChangeMotion) {
      return { state: { ...INITIAL_AUTO_CAPTURE_STATE }, shouldCapture: false };
    }
    return { state, shouldCapture: false };
  }

  const motionHistory = [...state.motionHistory, metrics.motion].slice(-AUTO_CAPTURE_CONFIG.historySize);
  const smoothedMotion = median(motionHistory);
  let evaluation = evaluateMetrics(metrics, smoothedMotion);
  if (evaluation.acceptable && metrics.motion > AUTO_CAPTURE_CONFIG.transientMotion) {
    evaluation = { ...evaluation, acceptable: false, blockingReason: "hold_steady" };
  }
  if (!evaluation.acceptable) {
    const history = [...state.history, false].slice(-AUTO_CAPTURE_CONFIG.historySize);
    const consecutiveMisses = [...history].reverse().findIndex(Boolean);
    const missCount = consecutiveMisses === -1 ? history.length : consecutiveMisses;
    const sustainedMotion = motionHistory.slice(-AUTO_CAPTURE_CONFIG.sustainedResetFrames)
      .filter((value) => value > AUTO_CAPTURE_CONFIG.resetMotion).length
      === AUTO_CAPTURE_CONFIG.sustainedResetFrames;
    const reset = missCount >= AUTO_CAPTURE_CONFIG.sustainedResetFrames || sustainedMotion;
    const keepProgress = state.phase === "holding" && !reset;
    return {
      state: {
        ...state,
        phase: keepProgress ? "holding" : "warming",
        history: reset ? [] : history,
        motionHistory: reset ? [] : motionHistory,
        smoothedMotion,
        holdStartedAt: keepProgress ? state.holdStartedAt : null,
        status: evaluation.blockingReason ?? "warming_up",
        blockingReason: evaluation.blockingReason,
        warnings: evaluation.warnings,
        countsTowardHold: false,
        progress: keepProgress ? Math.max(0, state.progress - 0.08) : 0,
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
  const warningStatus = evaluation.warnings.includes("low_light")
    ? "low_light"
    : evaluation.warnings.includes("soft_focus")
      ? "soft_focus"
      : evaluation.warnings.includes("slightly_off_center")
        ? "slightly_off_center"
        : null;
  const status: ReadinessCode = warningStatus && progress < 0.72 ? warningStatus : "almost_ready";
  return {
    state: shouldCapture
      ? {
          phase: "cooldown", history, motionHistory, smoothedMotion, holdStartedAt, capturedAt: now, status: "capturing",
          sceneChangedSinceCapture: false, blockingReason: null, warnings: evaluation.warnings, countsTowardHold: true, progress: 1,
        }
      : {
          phase: "holding", history, motionHistory, smoothedMotion, holdStartedAt, capturedAt: null, status,
          blockingReason: null, warnings: evaluation.warnings, countsTowardHold: true, progress,
        },
    shouldCapture,
  };
}

export function resetAutoCapture(): AutoCaptureState {
  return { ...INITIAL_AUTO_CAPTURE_STATE };
}
