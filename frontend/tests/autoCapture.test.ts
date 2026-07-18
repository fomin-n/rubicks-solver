import {
  AUTO_CAPTURE_CONFIG,
  INITIAL_AUTO_CAPTURE_STATE,
  advanceAutoCapture,
  evaluateMetrics,
  type CaptureMetrics,
} from "../src/camera/autoCapture";

const ready: CaptureMetrics = {
  brightness: 130,
  darkFraction: 0.01,
  glareFraction: 0.01,
  sharpness: 24,
  motion: 1,
  quadrantConsistency: 8,
  boundaryStrength: 30,
  alignmentScore: 0.8,
};

describe("auto capture state machine", () => {
  it("requires a stable hold and tolerates one moderate miss", () => {
    let state = { ...INITIAL_AUTO_CAPTURE_STATE };
    let captured = false;
    for (let time = 0; time <= 1_000; time += 100) {
      const metrics = time === 400 ? { ...ready, brightness: 40 } : ready;
      const result = advanceAutoCapture(state, metrics, time);
      state = result.state;
      captured ||= result.shouldCapture;
    }
    expect(captured).toBe(true);
    expect(state.phase).toBe("cooldown");
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

  it("returns specific actionable readiness states", () => {
    expect(evaluateMetrics({ ...ready, brightness: 20 })).toBe("too_dark");
    expect(evaluateMetrics({ ...ready, glareFraction: 0.2 })).toBe("reduce_glare");
    expect(evaluateMetrics({ ...ready, sharpness: 2 })).toBe("move_closer");
    expect(evaluateMetrics({ ...ready, alignmentScore: 0.2 })).toBe("center_cube");
    expect(evaluateMetrics({ ...ready, motion: 5 })).toBe("hold_steady");
  });
});
