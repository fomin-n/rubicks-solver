import type { CSSProperties } from "react";
import { CANONICAL_COLOR_HEX, PREVIEW_ORDER, SCAN_ORDER, type CapturedFacePreview, type Face } from "../types";

interface Props {
  previews: Partial<Record<Face, CapturedFacePreview>>;
  activeFace?: Face | null;
  problemFaces?: Face[];
  compact?: boolean;
  showInferred?: boolean;
  readOnly?: boolean;
  busy: boolean;
  onRetake: (face: Face) => void;
}

export function CapturedFaces({ previews, activeFace, problemFaces = [], compact = false, showInferred = false, readOnly = false, busy, onRetake }: Props) {
  const faceOrder = showInferred || previews.D ? PREVIEW_ORDER : SCAN_ORDER;
  const captured = faceOrder.filter((face) => previews[face]);
  if (!compact && !captured.length) return null;
  const visibleFaces = compact ? faceOrder : captured;
  return <section className={`captured-faces${compact ? " compact" : ""}`} aria-label="Captured faces">
    <div className="captured-faces-heading"><strong>Captured faces</strong><span>{captured.length} / {faceOrder.length}</span></div>
    <div className="captured-face-strip">
      {visibleFaces.map((face) => {
        const preview = previews[face];
        if (!preview) return <article key={face} className="captured-face pending" data-face={face} aria-label={`${face} not captured`}>
          <header><strong>{face}</strong><span>Pending</span></header>
          <div className="captured-face-placeholder" aria-hidden="true"><i /><i /><i /><i /></div>
        </article>;
        const lowConfidence = preview.confidence.some((value) => value < 0.25);
        const problematic = problemFaces.includes(face);
        return <article
          key={face}
          className={`captured-face${activeFace === face ? " active" : ""}${problematic ? " problem" : ""}`}
          data-face={face}
        >
          <header><strong>{face}</strong><span>{preview.source === "inferred" ? "Calculated" : preview.provisional ? "Provisional" : "Final"}</span></header>
          <div className="captured-face-grid" aria-label={`${face} recognized sticker preview`}>
            {preview.predictedColors.map((color, index) => <span key={`${color}-${index}`} style={{ "--preview-color": color ? CANONICAL_COLOR_HEX[color] : "#343a48" } as CSSProperties} title={color ?? "Unclassified"} />)}
          </div>
          <div className="captured-color-labels">{preview.predictedColors.map((color, index) => <span key={`${color}-${index}`}>{color ?? "?"}</span>)}</div>
          {(preview.warningCodes.length > 0 || lowConfidence || problematic) && <small>{problematic ? "Check this face" : lowConfidence ? "Low confidence" : "Usable with warning"}</small>}
          {!readOnly && preview.source === "scanned" && <button disabled={busy || activeFace === face} onClick={() => onRetake(face)}>Retake</button>}
        </article>;
      })}
    </div>
  </section>;
}
