import { useState } from "react";
import { colorCounts, rotateFace, updateSticker } from "./cube";
import { COLORS, FACES, type Face, type Facelets, type ValidationResponse } from "../types";

const FACE_POSITIONS: Record<Face, string> = { U: "net-u", L: "net-l", F: "net-f", R: "net-r", B: "net-b", D: "net-d" };

interface Props {
  facelets: Facelets;
  confidence: Record<Face, number[]> | null;
  validation: ValidationResponse | null;
  canRetake: boolean;
  busy: boolean;
  onChange: (facelets: Facelets) => void;
  onRetake: (face: Face) => void;
  onSolve: () => void;
}

export function CubeNetEditor({ facelets, confidence, validation, canRetake, busy, onChange, onRetake, onSolve }: Props) {
  const [selected, setSelected] = useState<{ face: Face; index: number } | null>(null);
  const counts = colorCounts(facelets);
  return <section className="editor panel">
    <div className="section-heading"><div><span className="eyebrow">Verify the scan</span><h1>Check every facelet</h1></div><p>Tap a sticker, then choose its actual color. Face labels describe scan geometry, not center colors.</p></div>
    {selected && <div className="palette" aria-label="Choose sticker color">{COLORS.map((color) => <button key={color} className={`swatch ${color}`} onClick={() => {
      onChange(updateSticker(facelets, selected.face, selected.index, color)); setSelected(null);
    }}><span>{color}</span></button>)}</div>}
    <div className="cube-net">{FACES.map((face) => <article key={face} className={`face-card ${FACE_POSITIONS[face]}`}>
      <header><strong>{face}</strong><span>{faceName(face)}</span></header>
      <div className="face-grid">{facelets[face].map((color, index) => <button key={index} aria-label={`${face} facelet ${index + 1}: ${color}`} title={`${color}${(confidence?.[face]?.[index] ?? 1) < 0.45 ? " — low confidence" : ""}`} className={`facelet ${color} ${(confidence?.[face]?.[index] ?? 1) < 0.45 ? "uncertain" : ""}`} onClick={() => setSelected({ face, index })}><span>{color.slice(0, 1).toUpperCase()}</span></button>)}</div>
      <div className="face-tools"><button onClick={() => onChange({ ...facelets, [face]: rotateFace(facelets[face], 3) })} aria-label={`Rotate ${face} counterclockwise`}>↶</button><button onClick={() => onChange({ ...facelets, [face]: rotateFace(facelets[face]) })} aria-label={`Rotate ${face} clockwise`}>↷</button>{canRetake && <button onClick={() => onRetake(face)}>Retake</button>}</div>
    </article>)}</div>
    <div className="verification-footer">
      <div><h2>Color counts</h2><div className="counts">{COLORS.map((color) => <span key={color} className={counts[color] === 4 ? "ok" : "bad"}><i className={`dot ${color}`} />{color}: {counts[color]}/4</span>)}</div></div>
      {validation && !validation.valid && <div className="alert error" role="alert"><strong>Not solvable yet</strong><ul>{validation.errors.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul>{validation.suggestions.map((item) => <p key={`${item.face}-${item.quarterTurns}`}>Suggestion: {item.message}</p>)}</div>}
      <button className="primary large" disabled={busy} onClick={onSolve}>{busy ? "Validating and solving…" : "Validate and solve"}</button>
    </div>
  </section>;
}

function faceName(face: Face) { return ({ U: "Up", R: "Right", F: "Front", D: "Down", L: "Left", B: "Back" } as const)[face]; }
