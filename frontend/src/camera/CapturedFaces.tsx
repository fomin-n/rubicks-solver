import type { CSSProperties } from "react";
import { SCAN_ORDER, type CapturedFacePreview, type Face } from "../types";

interface Props {
  previews: Partial<Record<Face, CapturedFacePreview>>;
  activeFace?: Face | null;
  problemFaces?: Face[];
  compact?: boolean;
  busy: boolean;
  onRetake: (face: Face) => void;
}

export function CapturedFaces({ previews, activeFace, problemFaces = [], compact = false, busy, onRetake }: Props) {
  const captured = SCAN_ORDER.filter((face) => previews[face]);
  if (!captured.length) return null;
  return <section className={`captured-faces${compact ? " compact" : ""}`} aria-label="Captured faces">
    <div className="captured-faces-heading"><strong>Captured faces</strong><span>{captured.length} / 6</span></div>
    <div className="captured-face-strip">
      {captured.map((face) => {
        const preview = previews[face]!;
        const lowConfidence = preview.confidence.some((value) => value < 0.25);
        const problematic = problemFaces.includes(face);
        return <article
          key={face}
          className={`captured-face${activeFace === face ? " active" : ""}${problematic ? " problem" : ""}`}
          data-face={face}
        >
          <header><strong>{face}</strong><span>{preview.provisional ? "Provisional" : "Final"}</span></header>
          <div className="captured-face-grid" aria-label={`${face} recognized sticker preview`}>
            {preview.previewHex.map((hex, index) => <span key={`${hex}-${index}`} style={{ "--preview-color": hex } as CSSProperties} title={preview.predictedColors[index] ?? "Unclassified"} />)}
          </div>
          <div className="captured-color-labels">{preview.predictedColors.map((color, index) => <span key={`${color}-${index}`}>{color ?? "?"}</span>)}</div>
          {(preview.warningCodes.length > 0 || lowConfidence || problematic) && <small>{problematic ? "Check this face" : lowConfidence ? "Low confidence" : "Usable with warning"}</small>}
          <button disabled={busy || activeFace === face} onClick={() => onRetake(face)}>Retake</button>
        </article>;
      })}
    </div>
  </section>;
}
