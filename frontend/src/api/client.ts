import { z } from "zod";
import { COLORS, FACES, type CaptureCommitMode, type Face, type Facelets, type SessionResponse, type SolveResponse, type UploadResponse, type ValidationResponse } from "../types";

const color = z.enum(COLORS);
const face = z.enum(FACES);
const facelets = z.record(face, z.array(color).length(4));
const capturedFace = z.object({
  face, previewHex: z.array(z.string()).length(4), predictedColors: z.array(color.nullable()).length(4),
  confidence: z.array(z.number()).length(4), provisional: z.boolean(), warnings: z.array(z.string()),
  warningCodes: z.array(z.string()),
});
const sessionSchema = z.object({
  sessionId: z.string().uuid(), scanOrder: z.array(face), scannedFaces: z.array(face), nextFace: face.nullable(),
  expiresAt: z.string(), facelets: facelets.nullable(), confidence: z.record(face, z.array(z.number())).nullable(),
  capturedFaces: z.partialRecord(face, capturedFace),
});
const validationSchema = z.object({
  valid: z.boolean(), colorCounts: z.record(color, z.number()),
  errors: z.array(z.object({ code: z.string(), message: z.string(), face: face.nullable(), faces: z.array(face) })),
  suggestions: z.array(z.object({ face, quarterTurns: z.number(), message: z.string() })),
});
const moveSchema = z.object({
  notation: z.string(), face: z.enum(["U", "R", "F"]), quarterTurns: z.number(), clockwise: z.boolean(), description: z.string(),
  overlay: z.object({ visibleFace: z.enum(["U", "R", "F"]), surface: z.string(), direction: z.string() }),
  resultingFacelets: facelets,
});
const solveSchema = z.object({
  metric: z.literal("HTM"), optimal: z.boolean(), moveCount: z.number(), initialFacelets: facelets,
  targetFaceColors: z.record(face, color), moves: z.array(moveSchema),
});
const uploadSchema = z.object({
  acceptable: z.boolean(), committed: z.boolean(), readinessCode: z.string(), readinessMessage: z.string(),
  face, samples: z.array(z.object({ lab: z.array(z.number()), previewHex: z.string(), consistency: z.number(), confidence: z.number().nullable() })),
  quality: z.object({
    blurScore: z.number(), boundaryScore: z.number(), underexposedFraction: z.number(),
    fullImageUnderexposedFraction: z.number(), stickerMedianBrightness: z.number(),
    overexposedFraction: z.number(), glareFraction: z.number(), warnings: z.array(z.string()),
    borderDarkFraction: z.number(), separatorDarkFraction: z.number(),
    stickerDarkFraction: z.number(), faceStructureScore: z.number(),
    warningCodes: z.array(z.string()),
    blockingReasons: z.array(z.string()), retakeRecommended: z.boolean(),
  }),
  scansComplete: z.boolean(), facelets: facelets.nullable(), confidence: z.record(face, z.array(z.number())).nullable(),
  preview: capturedFace, capturedFaces: z.partialRecord(face, capturedFace),
});

export class ApiClientError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

async function request<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try { response = await fetch(url, init); } catch { throw new ApiClientError("backend_unavailable", "The local backend is unavailable. Is make dev running?", 0); }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ code: "request_failed", message: response.statusText }));
    throw new ApiClientError(body.code ?? "request_failed", body.message ?? "Request failed", response.status);
  }
  if (response.status === 204) return undefined as T;
  return schema.parse(await response.json());
}

export const api = {
  createSession: () => request("/api/sessions", { method: "POST" }, sessionSchema) as Promise<SessionResponse>,
  deleteSession: (id: string) => request(`/api/sessions/${id}`, { method: "DELETE" }, z.undefined()),
  uploadFace: async (id: string, selectedFace: Face, blob: Blob, commitMode: CaptureCommitMode = "always") => {
    const data = new FormData(); data.append("image", blob, `${selectedFace}.jpg`);
    return request(`/api/sessions/${id}/faces/${selectedFace}?commitMode=${commitMode}`, { method: "POST", body: data }, uploadSchema) as Promise<UploadResponse>;
  },
  updateFacelets: (id: string, faces: Facelets) => request(`/api/sessions/${id}/facelets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ faces }) }, validationSchema) as Promise<ValidationResponse>,
  validate: (id: string) => request(`/api/sessions/${id}/validate`, { method: "POST" }, validationSchema) as Promise<ValidationResponse>,
  solve: (id: string) => request(`/api/sessions/${id}/solve`, { method: "POST" }, solveSchema) as Promise<SolveResponse>,
};
