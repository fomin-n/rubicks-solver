import { colorCounts, DEMO_FACELETS, rotateFace, SOLVED_FACELETS, updateSticker } from "../src/cube/cube";

describe("cube-net editing", () => {
  it("rotates a face clockwise and back", () => {
    const face = ["red", "blue", "orange", "white"] as const;
    expect(rotateFace([...face])).toEqual(["orange", "red", "white", "blue"]);
    expect(rotateFace(rotateFace([...face]), 3)).toEqual(face);
  });

  it("edits one sticker without mutating the input", () => {
    const edited = updateSticker(SOLVED_FACELETS, "U", 0, "red");
    expect(edited.U[0]).toBe("red");
    expect(SOLVED_FACELETS.U[0]).toBe("white");
  });

  it("counts all 24 facelets", () => {
    expect(colorCounts(DEMO_FACELETS)).toEqual({ red: 4, blue: 4, orange: 4, white: 4, green: 4, yellow: 4 });
  });
});

