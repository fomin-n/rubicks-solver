import type { CubeMove } from "../types";

const POLYGONS = { U: "80,85 180,35 280,85 180,135", F: "80,85 180,135 180,275 80,220", R: "180,135 280,85 280,220 180,275" };
const PATHS: Record<string, string> = {
  "U-clockwise": "M125 90 Q180 45 235 90", "U-counterclockwise": "M235 90 Q180 45 125 90", "U-half": "M120 92 Q180 38 240 92",
  "F-clockwise": "M105 120 Q70 175 115 230", "F-counterclockwise": "M115 230 Q70 175 105 120", "F-half": "M105 115 Q58 175 115 238",
  "R-clockwise": "M255 120 Q292 175 245 230", "R-counterclockwise": "M245 230 Q292 175 255 120", "R-half": "M255 115 Q305 175 245 238",
};

export function ArrowOverlay({ move }: { move: CubeMove }) {
  const key = `${move.face}-${move.overlay.direction}`;
  return <svg className="guidance-overlay" viewBox="0 0 360 310" role="img" aria-label={move.description}>
    <defs><marker id="arrow-head" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" /></marker>{move.overlay.direction === "half" && <marker id="arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="3" orient="auto-start-reverse"><path d="M7,0 L7,6 L0,3 z" /></marker>}</defs>
    {Object.entries(POLYGONS).map(([face, points]) => <polygon key={face} points={points} className={face === move.face ? "guide-face active" : "guide-face"} />)}
    <path d={PATHS[key]} className="turn-arrow" markerEnd="url(#arrow-head)" markerStart={move.overlay.direction === "half" ? "url(#arrow-start)" : undefined} />
  </svg>;
}

