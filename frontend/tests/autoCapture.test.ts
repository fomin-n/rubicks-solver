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
  borderDarkFraction: 0.82,
  separatorDarkFraction: 0.9,
  stickerDarkFraction: 0.01,
  faceStructureScore: 0.81,
};
const usableLowLight: CaptureMetrics = {
  ...ready,
  fullCropBrightness: 34,
  fullCropDarkFraction: 0.58,
  brightness: 42,
  lowerBrightnessPercentile: 26,
  darkFraction: 0.38,
};

const physicalFrameA: CaptureMetrics = {
  fullCropBrightness: 71.87965277777778,
  fullCropDarkFraction: 0.25592013888888887,
  brightness: 83.5,
  lowerBrightnessPercentile: 52,
  darkFraction: 0.014564043209876544,
  glareFraction: 0,
  sharpness: 4.439865039794887,
  motion: 6.068246527777778,
  quadrantConsistency: 8.133353736362773,
  boundaryStrength: 4.666666666666667,
  alignmentScore: 0.5896960587741086,
  borderDarkFraction: 0.53,
  separatorDarkFraction: 0.95,
  stickerDarkFraction: 0,
  faceStructureScore: 0.72,
};

const physicalFrameB: CaptureMetrics = {
  fullCropBrightness: 83.26125,
  fullCropDarkFraction: 0.20152777777777778,
  brightness: 87,
  lowerBrightnessPercentile: 51,
  darkFraction: 0.045717592592592594,
  glareFraction: 0,
  sharpness: 4.497887910995687,
  motion: 14.54953125,
  quadrantConsistency: 19.956319116491706,
  boundaryStrength: 6.308333333333334,
  alignmentScore: 0.5523727918947346,
  borderDarkFraction: 0.47,
  separatorDarkFraction: 0.89,
  stickerDarkFraction: 0,
  faceStructureScore: 0.66,
};

describe("auto capture state machine", () => {
  it("accepts repeated physical frame A observations and captures within one second", () => {
    expect(evaluateMetrics(physicalFrameA).blockingReason).toBeNull();
    let state = { ...INITIAL_AUTO_CAPTURE_STATE };
    let captured = false;
    for (let time = 0; time <= 900; time += 100) {
      const result = advanceAutoCapture(state, physicalFrameA, time);
      state = result.state;
      captured ||= result.shouldCapture;
    }
    expect(state.countsTowardHold).toBe(true);
    expect(captured).toBe(true);
  });

  it("does not misclassify physical frame B and preserves progress through its motion spike", () => {
    const evaluation = evaluateMetrics(physicalFrameB);
    expect(evaluation.blockingReason).not.toBe("move_closer");
    expect(evaluation.blockingReason).not.toBe("too_dark");
    let state = { ...INITIAL_AUTO_CAPTURE_STATE };
    state = advanceAutoCapture(state, physicalFrameA, 0).state;
    state = advanceAutoCapture(state, physicalFrameA, 100).state;
    const beforeSpike = state;
    state = advanceAutoCapture(state, physicalFrameB, 200).state;
    expect(state.holdStartedAt).toBe(beforeSpike.holdStartedAt);
    expect(state.progress).toBeGreaterThan(0);
    let captured = false;
    for (let time = 300; time <= 900; time += 100) {
      const result = advanceAutoCapture(state, physicalFrameA, time);
      state = result.state;
      captured ||= result.shouldCapture;
    }
    expect(captured).toBe(true);
  });

  it("combines softness with expected sticker boundaries", () => {
    expect(evaluateMetrics({ ...ready, sharpness: 4.4, boundaryStrength: 4.7 }).blockingReason).toBeNull();
    expect(evaluateMetrics({ ...ready, sharpness: 2.2, boundaryStrength: 5 }).warnings).toContain("soft_focus");
    expect(evaluateMetrics({ ...ready, sharpness: 0.8, boundaryStrength: 0.5 }).blockingReason).toBe("too_blurry");
    expect(evaluateMetrics({ ...ready, sharpness: 2, boundaryStrength: 30 }).acceptable).toBe(true);
  });

  it("uses smoothed motion and resets only after sustained large movement", () => {
    let state = { ...INITIAL_AUTO_CAPTURE_STATE };
    state = advanceAutoCapture(state, ready, 0).state;
    state = advanceAutoCapture(state, ready, 100).state;
    state = advanceAutoCapture(state, { ...ready, motion: 14 }, 200).state;
    expect(state.phase).toBe("holding");
    expect(state.progress).toBeGreaterThan(0);
    state = advanceAutoCapture(state, { ...ready, motion: 24 }, 300).state;
    state = advanceAutoCapture(state, { ...ready, motion: 24 }, 400).state;
    state = advanceAutoCapture(state, { ...ready, motion: 24 }, 500).state;
    expect(state.phase).toBe("warming");
    expect(state.progress).toBe(0);
  });

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
    const evaluation = evaluateMetrics({ ...usableLowLight, motion: 14 });
    expect(evaluation.acceptable).toBe(false);
    expect(evaluation.blockingReason).toBe("hold_steady");
    expect(evaluation.warnings).toContain("low_light");
  });

  it("tolerates one unusable fluctuation without restarting the hold", () => {
    let state = { ...INITIAL_AUTO_CAPTURE_STATE };
    let captured = false;
    for (let time = 0; time <= 1_000; time += 100) {
      const metrics = time === 400 ? { ...ready, sharpness: 0.5, boundaryStrength: 0.5 } : ready;
      const result = advanceAutoCapture(state, metrics, time);
      state = result.state;
      captured ||= result.shouldCapture;
    }
    expect(captured).toBe(true);
  });

  it("requires cooldown and a changed scene before rearming", () => {
    let state = { ...INITIAL_AUTO_CAPTURE_STATE };
    for (let time = 0; time <= AUTO_CAPTURE_CONFIG.holdMs + 100; time += 100) state = advanceAutoCapture(state, ready, time).state;
    expect(state.phase).toBe("cooldown");
    let result = advanceAutoCapture(state, ready, 1_800);
    expect(result.shouldCapture).toBe(false);
    expect(result.state.phase).toBe("scene_change");
    result = advanceAutoCapture(result.state, ready, 1_900);
    expect(result.state.phase).toBe("scene_change");
    result = advanceAutoCapture(result.state, { ...ready, motion: 10 }, 2_000);
    expect(result.state.phase).toBe("warming");
  });

  it("remembers a scene change that happens during cooldown", () => {
    let state = { ...INITIAL_AUTO_CAPTURE_STATE };
    for (let time = 0; time <= AUTO_CAPTURE_CONFIG.holdMs + 100; time += 100) {
      state = advanceAutoCapture(state, ready, time).state;
    }
    expect(state.phase).toBe("cooldown");
    state = advanceAutoCapture(state, { ...ready, motion: 20 }, 900).state;
    expect(state.sceneChangedSinceCapture).toBe(true);
    state = advanceAutoCapture(state, ready, 1_600).state;
    expect(state.phase).toBe("warming");
  });

  it("preserves glare, sharpness, alignment, and motion blockers", () => {
    expect(evaluateMetrics({ ...ready, glareFraction: 0.2 }).blockingReason).toBe("reduce_glare");
    expect(evaluateMetrics({ ...ready, sharpness: 0.5, boundaryStrength: 0.5 }).blockingReason).toBe("too_blurry");
    expect(evaluateMetrics({ ...ready, sharpness: 0.5, boundaryStrength: 0.5, alignmentScore: 0.2 }).blockingReason).toBe("too_blurry");
    expect(evaluateMetrics({ ...ready, sharpness: 3, boundaryStrength: 2, alignmentScore: 0.2 }).blockingReason).toBe("move_closer");
    expect(evaluateMetrics({ ...ready, alignmentScore: 0.2 }).blockingReason).toBe("center_cube");
    expect(evaluateMetrics({ ...ready, motion: 14 }).blockingReason).toBe("hold_steady");
  });

  it("rejects a stable unrelated object without the black 2x2 frame", () => {
    const unrelated = {
      ...ready,
      borderDarkFraction: 0.02,
      separatorDarkFraction: 0.04,
      stickerDarkFraction: 0,
      faceStructureScore: 0.03,
    };
    expect(evaluateMetrics(unrelated)).toEqual({
      acceptable: false,
      blockingReason: "center_cube",
      warnings: [],
    });
  });

  it("rejects highly inconsistent regions even when dark lines resemble a cross", () => {
    expect(evaluateMetrics({ ...ready, quadrantConsistency: 85 }).blockingReason).toBe("center_cube");
  });
});
