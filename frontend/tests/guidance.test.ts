import { DEMO_FACELETS, SOLVED_FACELETS } from "../src/cube/cube";
import { faceletsBeforeMove, inverseMove } from "../src/guidance/guidance";
import type { CubeMove } from "../src/types";

const move: CubeMove = {
  notation: "R'", face: "R", quarterTurns: -1, clockwise: false,
  description: "Turn the r face counterclockwise",
  overlay: { visibleFace: "R", surface: "r", direction: "counterclockwise" },
  resultingFacelets: SOLVED_FACELETS,
};

describe("guidance", () => {
  it("creates a real inverse instruction", () => {
    const inverse = inverseMove(move, DEMO_FACELETS);
    expect(inverse.notation).toBe("R");
    expect(inverse.quarterTurns).toBe(1);
    expect(inverse.overlay.direction).toBe("clockwise");
    expect(inverse.resultingFacelets).toBe(DEMO_FACELETS);
  });

  it("finds the state before a move", () => {
    expect(faceletsBeforeMove([move], DEMO_FACELETS, 0)).toBe(DEMO_FACELETS);
    expect(faceletsBeforeMove([move, move], DEMO_FACELETS, 1)).toBe(SOLVED_FACELETS);
  });
});

