import { api, ApiClientError } from "../src/api/client";

const validSession = {
  sessionId: "123e4567-e89b-12d3-a456-426614174000", scanOrder: ["F", "R", "B", "L", "U"],
  scannedFaces: [], nextFace: "F", expiresAt: "2026-07-18T12:00:00Z", facelets: null, confidence: null,
  capturedFaces: {}, completionStatus: "pending", completionDiagnostics: [],
};

afterEach(() => vi.unstubAllGlobals());

it("parses a valid session response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(validSession), { status: 201, headers: { "Content-Type": "application/json" } })));
  await expect(api.createSession()).resolves.toEqual(validSession);
});

it("rejects a malformed API response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessionId: "bad" }), { status: 201, headers: { "Content-Type": "application/json" } })));
  await expect(api.createSession()).rejects.toThrow();
});

it("turns backend failures into actionable errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "session_not_found", message: "Expired" }), { status: 404, headers: { "Content-Type": "application/json" } })));
  await expect(api.createSession()).rejects.toMatchObject({ code: "session_not_found", message: "Expired", status: 404 } satisfies Partial<ApiClientError>);
});
