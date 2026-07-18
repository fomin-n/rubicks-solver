import { render } from "@testing-library/react";
import { SOLVED_FACELETS } from "../src/cube/cube";
import { ArrowOverlay } from "../src/guidance/ArrowOverlay";
import type { CubeMove } from "../src/types";

const NOTATIONS = ["U", "U'", "U2", "R", "R'", "R2", "F", "F'", "F2"] as const;

function move(notation: typeof NOTATIONS[number]): CubeMove {
  const face = notation[0] as "U" | "R" | "F";
  const quarterTurns = notation.endsWith("2") ? 2 : notation.endsWith("'") ? -1 : 1;
  return {
    notation, face, quarterTurns, clockwise: quarterTurns > 0,
    description: `Turn ${face}`, overlay: { visibleFace: face, surface: face.toLowerCase(), direction: "" },
    resultingFacelets: SOLVED_FACELETS,
  };
}

it.each(NOTATIONS)("renders layered, directional guidance for %s", (notation) => {
  const current = move(notation);
  const { container } = render(<ArrowOverlay move={current} facelets={SOLVED_FACELETS} />);
  const guidance = container.querySelector(".turn-guidance");
  expect(guidance).toHaveAttribute("data-face", current.face);
  expect(guidance).toHaveAttribute("data-direction", notation.endsWith("2") ? "half" : notation.endsWith("'") ? "counterclockwise" : "clockwise");
  expect(container.querySelector(".active-face-wash")).toHaveAttribute("data-active-face", current.face);
  expect(container.querySelector(".turn-arrow-outline")).toBeInTheDocument();
  expect(container.querySelector(".turn-arrow")).toHaveAttribute("marker-end", "url(#arrow-head)");
  expect(container.querySelector(".turn-arrow-highlight")).toBeInTheDocument();
  expect(Boolean(container.querySelector(".half-turn-badge"))).toBe(notation.endsWith("2"));
  expect(container.querySelectorAll(".guide-sticker")).toHaveLength(12);
});
