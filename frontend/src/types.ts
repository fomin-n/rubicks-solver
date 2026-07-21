export const FACES = ["U", "R", "F", "D", "L", "B"] as const;
export type Face = (typeof FACES)[number];
export const SCAN_ORDER = ["F", "R", "B", "L", "U", "D"] as const;

export const COLORS = ["red", "blue", "orange", "white", "green", "yellow"] as const;
export type CubeColor = (typeof COLORS)[number];
export const CANONICAL_COLOR_HEX: Record<CubeColor, string> = {
  red: "#e84255",
  blue: "#3e88e9",
  orange: "#f39b38",
  white: "#edf0e8",
  green: "#38bf83",
  yellow: "#f1d54c",
};
export type Facelets = Record<Face, CubeColor[]>;

export interface SessionResponse {
  sessionId: string;
  scanOrder: Face[];
  scannedFaces: Face[];
  nextFace: Face | null;
  expiresAt: string;
  facelets: Facelets | null;
  confidence: Record<Face, number[]> | null;
  capturedFaces: Partial<Record<Face, CapturedFacePreview>>;
}

export interface CapturedFacePreview {
  face: Face;
  previewHex: string[];
  predictedColors: (CubeColor | null)[];
  confidence: number[];
  provisional: boolean;
  warnings: string[];
  warningCodes: string[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  face: Face | null;
  faces: Face[];
}

export interface ValidationResponse {
  valid: boolean;
  colorCounts: Record<CubeColor, number>;
  errors: ValidationIssue[];
  suggestions: { face: Face; quarterTurns: number; message: string }[];
}

export interface CubeMove {
  notation: string;
  face: "U" | "R" | "F";
  quarterTurns: number;
  clockwise: boolean;
  description: string;
  overlay: { visibleFace: "U" | "R" | "F"; surface: string; direction: string };
  resultingFacelets: Facelets;
}

export interface SolveResponse {
  metric: "HTM";
  optimal: boolean;
  moveCount: number;
  initialFacelets: Facelets;
  targetFaceColors: Record<Face, CubeColor>;
  moves: CubeMove[];
}

export interface UploadResponse {
  face: Face;
  acceptable: boolean;
  committed: boolean;
  readinessCode: string;
  readinessMessage: string;
  samples: { lab: number[]; previewHex: string; consistency: number; confidence: number | null }[];
  quality: {
    blurScore: number;
    boundaryScore: number;
    underexposedFraction: number;
    fullImageUnderexposedFraction: number;
    stickerMedianBrightness: number;
    overexposedFraction: number;
    glareFraction: number;
    borderDarkFraction: number;
    separatorDarkFraction: number;
    stickerDarkFraction: number;
    faceStructureScore: number;
    warnings: string[];
    warningCodes: string[];
    blockingReasons: string[];
    retakeRecommended: boolean;
  };
  scansComplete: boolean;
  facelets: Facelets | null;
  confidence: Record<Face, number[]> | null;
  preview: CapturedFacePreview;
  capturedFaces: Partial<Record<Face, CapturedFacePreview>>;
}

export type CaptureCommitMode = "always" | "if_acceptable" | "never";
