import type { CubeMove } from "../types";

export interface Point { x: number; y: number }
export type VisibleFace = "U" | "F" | "R";
export type Quad = readonly [Point, Point, Point, Point];

export const FACE_QUADS: Record<VisibleFace, Quad> = {
  U: [{ x: 180, y: 35 }, { x: 280, y: 85 }, { x: 180, y: 135 }, { x: 80, y: 85 }],
  F: [{ x: 80, y: 85 }, { x: 180, y: 135 }, { x: 180, y: 275 }, { x: 80, y: 220 }],
  R: [{ x: 180, y: 135 }, { x: 280, y: 85 }, { x: 280, y: 220 }, { x: 180, y: 275 }],
};

export function projectPoint(quad: Quad, u: number, v: number): Point {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  return {
    x: (1 - u) * (1 - v) * topLeft.x + u * (1 - v) * topRight.x + u * v * bottomRight.x + (1 - u) * v * bottomLeft.x,
    y: (1 - u) * (1 - v) * topLeft.y + u * (1 - v) * topRight.y + u * v * bottomRight.y + (1 - u) * v * bottomLeft.y,
  };
}

export function faceletPolygons(face: VisibleFace): Point[][] {
  const quad = FACE_QUADS[face];
  const cells = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;
  return cells.map(([column, row]) => {
    const gap = 0.018;
    const u0 = column / 2 + gap;
    const u1 = (column + 1) / 2 - gap;
    const v0 = row / 2 + gap;
    const v1 = (row + 1) / 2 - gap;
    return [projectPoint(quad, u0, v0), projectPoint(quad, u1, v0), projectPoint(quad, u1, v1), projectPoint(quad, u0, v1)];
  });
}

export interface ArrowGeometry {
  path: string;
  badge: Point;
  direction: "clockwise" | "counterclockwise" | "half";
  sweepSign: -1 | 1;
  halfTurn: boolean;
}

export function arrowGeometry(move: Pick<CubeMove, "face" | "quarterTurns">): ArrowGeometry {
  const halfTurn = Math.abs(move.quarterTurns) === 2;
  const sweepSign: -1 | 1 = move.quarterTurns < 0 ? -1 : 1;
  const start = -145;
  const sweep = halfTurn ? 205 : 150;
  const pointCount = halfTurn ? 26 : 20;
  const clockwisePoints = Array.from({ length: pointCount }, (_, index) => {
    const angle = (start + sweep * index / (pointCount - 1)) * Math.PI / 180;
    return projectPoint(FACE_QUADS[move.face], 0.5 + Math.cos(angle) * 0.36, 0.5 + Math.sin(angle) * 0.36);
  });
  const points = sweepSign > 0 ? clockwisePoints : [...clockwisePoints].reverse();
  return {
    path: points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" "),
    badge: projectPoint(FACE_QUADS[move.face], 0.5, 0.5),
    direction: halfTurn ? "half" : sweepSign > 0 ? "clockwise" : "counterclockwise",
    sweepSign,
    halfTurn,
  };
}

export function pointsAttribute(points: Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}
