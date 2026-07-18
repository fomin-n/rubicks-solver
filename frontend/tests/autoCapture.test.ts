import {
  AUTO_CAPTURE_CONFIG,
  INITIAL_AUTO_CAPTURE_STATE,
  advanceAutoCapture,
  evaluateMetrics,
  type CaptureMetrics,
} from "../src/camera/autoCapture";

const ready: CaptureMetrics = {
  fullCropBrightness: 125,
  fullCropDarkFraction: 0.08,
  brightness: 130,
  lowerBrightnessPercentile: 70,
  darkFraction: 0.01,
  glareFraction: 0.01,
  sharpness: 24,
  motion: 1,
  quadrantConsistency: 8,
  boundaryStrength: 30,
  alignmentScore: 0.8,
};
const usableLowLight: CaptureMetrics = {
  ...ready,
  fullCropBrightness: 34,
  fullCropDarkFraction: 0.58,
  brightness: 42,
  lowerBrightnessPercentile: 26,
  darkFraction: 0.38,
};

describe("auto capture state machine", () => {
  it("captures moderately dark but usable frames with a soft warning", () => {
    const evaluation = evaluateMetrics(usableLowLight);
    expect(evaluation).toEqual({ acceptable: true, blockingReason: null, warnings: ["low_light"] });
    let state = { ...INITIAL_AUTO_CAPTURE_STATE };
    let captured = false;
    for (let time = 0; time <= 1_000; time += 100) {
      const result = advanceAutoCapture(state, usableLowLight, time);
      state = result.state;
      captured ||= result.shouldCapture;
    }
    expect(captured).toBe(true);
    expect(state.phase).toBe("cooldown");
    expect(state.warnings).toContain("low_light");
  });

  it("blocks genuinely near-black frames", () => {
    const extreme = {
      ...usableLowLight,
      brightness: 9,
      lowerBrightnessPercentile: 3,
      darkFraction: 0.92,
    };
    expect(evaluateMetrics(extreme).blockingReason).toBe("too_dark");
    let state = { ...INITIAL_AUTO_CAPTURE_STATE };
    for (let time = 0; time <= 1_500; time += 100) state = advanceAutoCapture(state, extreme, time).state;
    expect(state.status).toBe("too_dark");
    expect(state.progress).toBe(0);
    expect(state.countsTowardHold).toBe(false);
  });

  it("reports motion as the blocker while retaining the low-light warning", () => {
    const evaluation = evaluateMetrics({ ...usableLowLight, motion: 5 });
    expect(evaluation.acceptable).toBe(false);
    expect(evaluation.blockingReason).toBe("hold_steady");
    expect(evaluation.warnings).toContain("low_light");
  });

  it("tolerates one unusable fluctuation without restarting the hold", () => {
    let state = { ...INITIAL_AUTO_CAPTURE_STATE };
    let captured = false;
    for (let time = 0; time <= 1_000; time += 100) {
      const metrics = time === 400 ? { ...ready, sharpness: 2 } : ready;
      const result = advanceAutoCapture(state, metrics, time);
      state = result.state;
      captured ||= result.shouldCapture;
    }
    expect(captured).toBe(true);
  });

  it("requires cooldown and a changed scene before rearming", () => {
    let state = { ...INITIAL_AUTO_CAPTURE_STATE };
    for (let time = 0; time <= AUTO_CAPTURE_CONFIG.holdMs; time += 100) state = advanceAutoCapture(state, ready, time).state;
    expect(state.phase).toBe("cooldown");
    let result = advanceAutoCapture(state, ready, 1_800);
    expect(result.shouldCapture).toBe(false);
    expect(result.state.phase).toBe("scene_change");
    result = advanceAutoCapture(result.state, ready, 1_900);
    expect(result.state.phase).toBe("scene_change");
    result = advanceAutoCapture(result.state, { ...ready, motion: 10 }, 2_000);
    expect(result.state.phase).toBe("warming");
  });

  it("preserves glare, sharpness, alignment, and motion blockers", () => {
    expect(evaluateMetrics({ ...ready, glareFraction: 0.2 }).blockingReason).toBe("reduce_glare");
    expect(evaluateMetrics({ ...ready, sharpness: 2 }).blockingReason).toBe("move_closer");
    expect(evaluateMetrics({ ...ready, alignmentScore: 0.2 }).blockingReason).toBe("center_cube");
    expect(evaluateMetrics({ ...ready, motion: 5 }).blockingReason).toBe("hold_steady");
  });
});
