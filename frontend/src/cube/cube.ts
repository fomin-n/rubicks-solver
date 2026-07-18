import { COLORS, FACES, type CubeColor, type Face, type Facelets } from "../types";

export function rotateFace(stickers: CubeColor[], turns = 1): CubeColor[] {
  let result = [...stickers];
  for (let i = 0; i < ((turns % 4) + 4) % 4; i += 1) result = [result[2], result[0], result[3], result[1]];
  return result;
}

export function updateSticker(facelets: Facelets, face: Face, index: number, color: CubeColor): Facelets {
  return { ...facelets, [face]: facelets[face].map((value, current) => current === index ? color : value) };
}

export function colorCounts(facelets: Facelets): Record<CubeColor, number> {
  const result = Object.fromEntries(COLORS.map((color) => [color, 0])) as Record<CubeColor, number>;
  for (const face of FACES) for (const color of facelets[face]) result[color] += 1;
  return result;
}

export const SOLVED_FACELETS: Facelets = {
  U: ["white", "white", "white", "white"], R: ["red", "red", "red", "red"],
  F: ["green", "green", "green", "green"], D: ["yellow", "yellow", "yellow", "yellow"],
  L: ["orange", "orange", "orange", "orange"], B: ["blue", "blue", "blue", "blue"],
};

export const DEMO_FACELETS: Facelets = {
  U: ["blue", "white", "green", "yellow"], R: ["orange", "green", "white", "blue"],
  F: ["red", "green", "orange", "orange"], D: ["blue", "green", "yellow", "red"],
  L: ["red", "yellow", "orange", "white"], B: ["red", "white", "yellow", "blue"],
};

