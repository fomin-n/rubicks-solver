import type { CSSProperties } from "react";
import { COLORS, type CubeColor, type CubeMove, type Facelets } from "../types";
import { FACE_QUADS, arrowGeometry, faceletPolygons, pointsAttribute, type VisibleFace } from "./projection";

const COLOR_HEX: Record<CubeColor, string> = {
  red: "#e84255",
  blue: "#3e88e9",
  orange: "#f39b38",
  white: "#edf0e8",
  green: "#38bf83",
  yellow: "#f1d54c",
};

export function ArrowOverlay({ move, facelets, calibration = false }: { move: CubeMove; facelets: Facelets; calibration?: boolean }) {
  const arrow = arrowGeometry(move);
  const faces = Object.keys(FACE_QUADS) as VisibleFace[];
  return <svg className={`guidance-overlay${calibration ? " calibration" : ""}`} viewBox="0 0 360 310" role="img" aria-label={calibration ? "Colored Up Front Right orientation guide" : move.description}>
    <defs>
      <marker id="arrow-head" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" /></marker>
      <marker id="arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="3" orient="auto-start-reverse"><path d="M7,0 L7,6 L0,3 z" /></marker>
    </defs>
    {faces.flatMap((face) => faceletPolygons(face).map((points, index) => <polygon
      key={`${face}-${index}`}
      data-face={face}
      data-facelet={index}
      points={pointsAttribute(points)}
      className={`guide-sticker ${face === move.face && !calibration ? "active" : ""}`}
      style={{ "--guide-color": COLOR_HEX[facelets[face][index]] } as CSSProperties}
    />))}
    {faces.map((face) => <polygon key={`${face}-outline`} points={pointsAttribute([...FACE_QUADS[face]])} className={`guide-face-outline ${face === move.face && !calibration ? "active" : ""}`} />)}
    {!calibration && <>
      <path data-direction={arrow.direction} data-sweep={arrow.sweepSign} d={arrow.path} className="turn-arrow" markerEnd="url(#arrow-head)" markerStart={arrow.halfTurn ? "url(#arrow-start)" : undefined} />
      {arrow.halfTurn && <text className="half-turn-label" x="180" y="300">180°</text>}
    </>}
    {calibration && faces.map((face) => <text key={`${face}-label`} className="guide-face-label" x={face === "F" ? 125 : face === "R" ? 235 : 180} y={face === "U" ? 88 : 190}>{face}</text>)}
    <title>{COLORS.length} physical colors shown from the current cube state</title>
  </svg>;
}
