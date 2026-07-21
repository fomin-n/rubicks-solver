import type { CSSProperties } from "react";
import { CANONICAL_COLOR_HEX, COLORS, type CubeMove, type Facelets } from "../types";
import { FACE_QUADS, arrowGeometry, faceletPolygons, pointsAttribute, type VisibleFace } from "./projection";

export function ArrowOverlay({ move, facelets, calibration = false }: { move: CubeMove; facelets: Facelets; calibration?: boolean }) {
  const arrow = arrowGeometry(move);
  const faces = Object.keys(FACE_QUADS) as VisibleFace[];
  return <svg className={`guidance-overlay${calibration ? " calibration" : ""}`} viewBox="0 0 360 310" role="img" aria-label={calibration ? "Colored Up Front Right orientation guide" : move.description}>
    <defs>
      <marker id="arrow-head" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse">
        <path className="arrow-head-outline" d="M1 1 L8 5 L1 9" />
        <path className="arrow-head-tip" d="M1 1 L8 5 L1 9" />
      </marker>
    </defs>
    {faces.flatMap((face) => faceletPolygons(face).map((points, index) => <polygon
      key={`${face}-${index}`}
      data-face={face}
      data-facelet={index}
      points={pointsAttribute(points)}
      className={`guide-sticker ${face === move.face && !calibration ? "active" : ""}`}
      style={{ "--guide-color": CANONICAL_COLOR_HEX[facelets[face][index]] } as CSSProperties}
    />))}
    {!calibration && <polygon points={pointsAttribute([...FACE_QUADS[move.face]])} className="active-face-wash" data-active-face={move.face} />}
    {faces.map((face) => <polygon key={`${face}-outline`} points={pointsAttribute([...FACE_QUADS[face]])} className={`guide-face-outline ${face === move.face && !calibration ? "active" : ""}`} />)}
    {!calibration && <g className="turn-guidance" data-face={move.face} data-direction={arrow.direction} data-half-turn={arrow.halfTurn}>
      <path d={arrow.path} className="turn-arrow-outline" />
      <path d={arrow.path} className="turn-arrow" markerEnd="url(#arrow-head)" />
      <path d={arrow.path} className="turn-arrow-highlight" />
      {arrow.halfTurn && <g className="half-turn-badge" aria-label="180 degree turn"><rect x={arrow.badge.x - 24} y={arrow.badge.y - 11} width="48" height="22" rx="11" /><text className="half-turn-label" x={arrow.badge.x} y={arrow.badge.y + 6}>180°</text></g>}
    </g>}
    {calibration && faces.map((face) => <text key={`${face}-label`} className="guide-face-label" x={face === "F" ? 125 : face === "R" ? 235 : 180} y={face === "U" ? 88 : 190}>{face}</text>)}
    <title>{COLORS.length} physical colors shown from the current cube state</title>
  </svg>;
}
