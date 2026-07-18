import type { CubeMove, Facelets } from "../types";

function notation(face: string, turns: number): string { return turns === 2 || turns === -2 ? `${face}2` : turns < 0 ? `${face}'` : face; }

export function inverseMove(move: CubeMove, resultingFacelets: Facelets): CubeMove {
  const turns = Math.abs(move.quarterTurns) === 2 ? 2 : -move.quarterTurns;
  const direction = Math.abs(turns) === 2 ? "half" : turns > 0 ? "clockwise" : "counterclockwise";
  return {
    ...move, notation: notation(move.face, turns), quarterTurns: turns, clockwise: turns > 0,
    description: `Turn the ${move.face.toLowerCase()} face ${direction === "half" ? "180 degrees" : direction}`,
    overlay: { ...move.overlay, direction }, resultingFacelets,
  };
}

export function faceletsBeforeMove(moves: CubeMove[], initial: Facelets, index: number): Facelets {
  return index === 0 ? initial : moves[index - 1].resultingFacelets;
}

