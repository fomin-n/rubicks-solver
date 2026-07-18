import type { CaptureCommitMode } from "../types";

export type CaptureSource = "auto" | "manual" | "upload";

export function commitModeForCapture(source: CaptureSource): CaptureCommitMode {
  return source === "auto" ? "if_acceptable" : "always";
}
