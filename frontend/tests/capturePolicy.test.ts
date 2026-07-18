import { commitModeForCapture } from "../src/camera/capturePolicy";

describe("capture source policy", () => {
  it("quality-gates only automatic candidates", () => {
    expect(commitModeForCapture("auto")).toBe("if_acceptable");
    expect(commitModeForCapture("manual")).toBe("always");
    expect(commitModeForCapture("upload")).toBe("always");
  });
});
