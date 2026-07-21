import { expect, test, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";

const SCANS = {
  F: ["red", "green", "orange", "orange"],
  R: ["orange", "green", "white", "blue"],
  B: ["red", "white", "yellow", "blue"],
  L: ["red", "yellow", "orange", "white"],
  U: ["blue", "white", "green", "yellow"],
  D: ["blue", "green", "yellow", "red"],
} as const;
const INVALID_SCANS = { ...SCANS, F: ["green", "red", "orange", "orange"] } as const;
const SCAN_ORDER_INDEX = { F: 0, R: 1, B: 2, L: 3, U: 4, D: 5 } as const;
type ScanFixture = Record<keyof typeof SCANS, readonly string[]>;

async function installSyntheticCamera(page: Page, scans: ScanFixture = SCANS) {
  await page.addInitScript(({ scans: injectedScans }) => {
    const colors: Record<string, string> = { red: "#d72d3d", blue: "#2468ce", orange: "#e87918", white: "#e4e7df", green: "#24a665", yellow: "#dfc525" };
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 640;
    const context = canvas.getContext("2d")!;
    let currentFace: keyof typeof injectedScans = "F";
    let changedFrames = 0;
    let activeTrack: CanvasCaptureMediaStreamTrack | undefined;
    const draw = (face: keyof typeof injectedScans) => {
      currentFace = face;
      injectedScans[face].forEach((color, index) => {
        context.fillStyle = colors[color];
        context.fillRect(index % 2 * 320, Math.floor(index / 2) * 320, 320, 320);
      });
      // Keep the scene-change signal pending until the analyzer has actually
      // observed it. Backend processing can outlast the capture cooldown.
      changedFrames = 8;
      activeTrack?.requestFrame();
    };
    draw("F");
    changedFrames = 0;
    (window as unknown as { setSyntheticFace: (face: keyof typeof injectedScans) => void }).setSyntheticFace = draw;
    (window as unknown as {
      setSyntheticFaceColors: (face: keyof typeof injectedScans, values: string[]) => void;
    }).setSyntheticFaceColors = (face, values) => {
      (injectedScans as Record<string, string[]>)[face] = [...values];
      draw(face);
    };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: async () => {
        const stream = canvas.captureStream(0);
        activeTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
        Object.defineProperty(activeTrack, "getSettings", { configurable: true, value: () => ({ deviceId: "synthetic", facingMode: "environment" }) });
        activeTrack.requestFrame();
        window.setInterval(() => {
          context.fillStyle = "#121212";
          context.fillRect(0, 0, 1, 1);
          activeTrack?.requestFrame();
        }, 50);
        return stream;
      },
      enumerateDevices: async () => [
        { deviceId: "synthetic", kind: "videoinput", label: "Synthetic rear camera", groupId: "synthetic", toJSON: () => ({}) },
        { deviceId: "synthetic-front", kind: "videoinput", label: "Synthetic front camera", groupId: "synthetic", toJSON: () => ({}) },
      ],
    } });
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: () => true });
    (window as unknown as { __rubiksE2ECamera: object }).__rubiksE2ECamera = {
      metrics: () => ({
        fullCropBrightness: 71.87965277777778,
        fullCropDarkFraction: 0.25592013888888887,
        brightness: 83.5,
        lowerBrightnessPercentile: 52,
        darkFraction: 0.014564043209876544,
        glareFraction: 0,
        sharpness: 4.439865039794887,
        motion: changedFrames-- > 0 ? 20 : 6.068246527777778,
        quadrantConsistency: 8.133353736362773,
        boundaryStrength: 4.666666666666667,
        alignmentScore: 0.5896960587741086,
        borderDarkFraction: 0.53,
        separatorDarkFraction: 0.95,
        stickerDarkFraction: 0,
        faceStructureScore: 0.72,
      }),
      captureBlob: () => new Promise<Blob>((resolve) => {
        const output = document.createElement("canvas");
        output.width = 640;
        output.height = 640;
        const outputContext = output.getContext("2d")!;
        outputContext.fillStyle = "#121212";
        outputContext.fillRect(0, 0, 640, 640);
        injectedScans[currentFace].forEach((color, index) => {
          outputContext.fillStyle = colors[color];
          outputContext.fillRect(index % 2 * 320 + 12, Math.floor(index / 2) * 320 + 12, 296, 296);
        });
        output.toBlob((blob) => resolve(blob!), "image/jpeg", 0.95);
      }),
    };
  }, { scans });
}

async function startCameraScan(page: Page) {
  await page.goto("/?captureDebug=1");
  await page.getByRole("button", { name: "Start scanning" }).click();
  await page.getByRole("button", { name: "Allow camera" }).click();
  await expect(page.getByRole("heading", { name: "F · Front" })).toBeVisible();
}

interface ScanGeometry {
  stage: { x: number; y: number; width: number; height: number };
  guide: { x: number; y: number; width: number; height: number } | null;
}

async function scanGeometry(page: Page): Promise<ScanGeometry> {
  return await page.evaluate(() => {
    const rectangle = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    };
    const stage = rectangle(".camera-stage");
    if (!stage) throw new Error("Camera stage is missing");
    if (stage.width < 240 || stage.height < 240) throw new Error(`Camera stage collapsed to ${stage.width}×${stage.height}`);
    const stageElement = document.querySelector<HTMLElement>(".camera-stage");
    const stageMedia = stageElement?.querySelector<HTMLElement>(".camera-video, .camera-placeholder");
    if (!stageElement || getComputedStyle(stageElement).contain !== "none") throw new Error("Camera stage must not use CSS containment");
    if (!stageMedia || getComputedStyle(stageMedia).position !== "absolute") throw new Error("Camera media must not contribute intrinsic layout size");
    if (getComputedStyle(document.body).position === "fixed") throw new Error("The camera cannot live inside a fixed document compositor");
    const scrolling = document.scrollingElement;
    if (!scrolling || scrolling.scrollHeight > window.innerHeight + 1 || scrolling.scrollWidth > window.innerWidth + 1) {
      throw new Error("Scan document exceeds the mobile viewport");
    }
    if (window.scrollX !== 0 || window.scrollY !== 0) throw new Error("Scan document moved away from its origin");
    const guide = rectangle(".scan-guide");
    const readiness = rectangle(".capture-readiness");
    if (guide && readiness) {
      if (guide.width > Math.min(stage.width, stage.height) * 0.4) throw new Error("Cube guide was not reduced to the smaller ROI");
      const overlaps = readiness.x < guide.x + guide.width && readiness.x + readiness.width > guide.x
        && readiness.y < guide.y + guide.height && readiness.y + readiness.height > guide.y;
      if (overlaps) throw new Error("Capture status overlaps the cube guide");
    }
    return { stage, guide };
  });
}

function expectSameGeometry(actual: ScanGeometry, expected: ScanGeometry) {
  for (const key of ["x", "y", "width", "height"] as const) expect(actual.stage[key]).toBeCloseTo(expected.stage[key], 0);
  if (expected.guide) {
    expect(actual.guide).not.toBeNull();
    for (const key of ["x", "y", "width", "height"] as const) expect(actual.guide![key]).toBeCloseTo(expected.guide[key], 0);
  }
}

async function uploadSyntheticFace(page: Page, face: keyof typeof SCANS) {
  const base64 = await page.evaluate((stickers) => {
    const colors: Record<string, string> = { red: "#d72d3d", blue: "#2468ce", orange: "#e87918", white: "#e4e7df", green: "#24a665", yellow: "#dfc525" };
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 640;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#121212";
    context.fillRect(0, 0, 640, 640);
    stickers.forEach((color, index) => {
      context.fillStyle = colors[color];
      context.fillRect(index % 2 * 320 + 12, Math.floor(index / 2) * 320 + 12, 296, 296);
    });
    return canvas.toDataURL("image/png").split(",")[1];
  }, [...SCANS[face]]);
  await page.locator('input[type="file"]').setInputFiles({ name: `${face}.png`, mimeType: "image/png", buffer: Buffer.from(base64, "base64") });
}

test("physical-frame auto capture previews, retakes, solves directly, and guides safely", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Canvas MediaStream injection is the deterministic Chromium camera test.");
  await installSyntheticCamera(page);
  await startCameraScan(page);
  await expect(page.getByLabel("Camera", { exact: true })).toHaveValue("synthetic");
  await page.evaluate(() => (window as unknown as { setSyntheticFace: (face: string) => void }).setSyntheticFace("F"));
  await expect.poll(async () => await page.getByLabel("Live camera preview", { exact: true }).evaluate((element) => {
    const video = element as HTMLVideoElement;
    const stream = video.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()[0];
    return { paused: video.paused, width: video.videoWidth, streamActive: stream?.active, trackMuted: track?.muted, trackState: track?.readyState };
  })).toMatchObject({ paused: false, width: 640, streamActive: true, trackMuted: false, trackState: "live" });
  await expect.poll(async () => await page.locator(".camera-preview-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const bounds = canvas.getBoundingClientRect();
    return canvas.classList.contains("active") && bounds.width >= 240 && bounds.height >= 240;
  })).toBe(true);
  await expect.poll(async () => await page.locator(".camera-preview-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) return false;
    const pixel = context.getImageData(Math.floor(canvas.width / 4), Math.floor(canvas.height / 4), 1, 1).data;
    return pixel[3] === 255 && pixel[0] + pixel[1] + pixel[2] > 0;
  })).toBe(true);
  await expect(page.getByRole("button", { name: "Tap to show camera" })).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "R · Right" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Captured faces", { exact: true })).toBeVisible();
  await expect(page.locator(".captured-faces.compact article.captured-face")).toHaveCount(6);
  await expect(page.getByLabel("F recognized sticker preview").locator("span")).toHaveCount(4);
  await expect(page.getByLabel("F recognized sticker preview").locator("span").first()).toHaveCSS("--preview-color", "#e84255");
  const stableGeometry = await scanGeometry(page);
  await page.getByText("Capture diagnostics", { exact: true }).click();
  await expect(page.getByText("smoothedMotion", { exact: false })).toBeVisible();

  await page.evaluate(() => (window as unknown as { setSyntheticFace: (face: string) => void }).setSyntheticFace("R"));
  await expect(page.getByRole("heading", { name: "B · Back" })).toBeVisible({ timeout: 15_000 });
  const frontPreview = page.locator('article.captured-face[data-face="F"]');
  await frontPreview.getByRole("button", { name: "Retake" }).click();
  await expect(page.getByRole("heading", { name: "F · Front" })).toBeVisible();
  expectSameGeometry(await scanGeometry(page), stableGeometry);
  await page.evaluate(() => (window as unknown as { setSyntheticFace: (face: string) => void }).setSyntheticFace("F"));
  await expect(page.getByRole("heading", { name: "B · Back" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("R recognized sticker preview")).toBeVisible();

  for (const [face, name] of [["B", "Back"], ["L", "Left"], ["U", "Up"], ["D", "Down"]] as const) {
    await expect(page.getByRole("heading", { name: `${face} · ${name}` })).toBeVisible({ timeout: 15_000 });
    await page.evaluate((nextFace) => (window as unknown as { setSyntheticFace: (face: string) => void }).setSyntheticFace(nextFace), face);
  }
  await expect(page.getByRole("button", { name: "Start camera guidance" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Check every facelet" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Validate and solve" })).toHaveCount(0);
  await page.getByRole("button", { name: "Start camera guidance" }).click();
  await page.getByRole("button", { name: "Orientation matched" }).click();
  const moveLabel = page.getByText(/Move 1 of/);
  await expect(moveLabel).toBeVisible();
  await page.getByRole("button", { name: "Manual advance" }).click();
  const total = Number((await moveLabel.textContent())?.match(/of (\d+)/)?.[1]);
  expect(total).toBeGreaterThan(1);

  await page.getByRole("button", { name: "Done / Next" }).click();
  await page.getByRole("button", { name: "Previous / Undo" }).click();
  await expect(page.getByText("Undo previous move", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done undoing" }).click();
  await expect(page.getByText(/Move 1 of/)).toBeVisible();

  await page.getByRole("button", { name: "Done / Next" }).click();
  await page.getByRole("button", { name: "Restart safely" }).click();
  await expect(page.getByText("Returning to start · 1 remaining", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Done reversing" }).click();
  await expect(page.getByText(/Move 1 of/)).toBeVisible();

  for (let index = 0; index < total; index += 1) await page.getByRole("button", { name: "Done / Next" }).click();
  await expect(page.getByRole("heading", { name: "Cube solved! 🎉" })).toBeVisible();
  await expect(page.getByLabel("Live solved cube camera")).toBeVisible();
  await expect(page.locator(".guidance-overlay")).toHaveCount(0);
  await expect(page.locator(".active-face-wash")).toHaveCount(0);
  await expect(page.locator(".turn-arrow")).toHaveCount(0);
  await expect.poll(async () => await page.getByLabel("Live solved cube camera").evaluate((element) => {
    const video = element as HTMLVideoElement;
    const stream = video.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()[0];
    return { streamActive: stream?.active, trackState: track?.readyState };
  })).toEqual({ streamActive: true, trackState: "live" });
  const bannerPlacement = await page.locator(".solved-banner").evaluate((element) => {
    const banner = element.getBoundingClientRect();
    const video = element.parentElement!.getBoundingClientRect();
    return { fromTop: banner.top - video.top, fromBottom: video.bottom - banner.bottom, videoHeight: video.height };
  });
  expect(Math.min(bannerPlacement.fromTop, bannerPlacement.fromBottom)).toBeLessThan(32);
  expect(bannerPlacement.fromTop).toBeGreaterThan(bannerPlacement.videoHeight / 2);
});

test("manual capture commits immediately without a second confirmation", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Canvas MediaStream injection is the deterministic Chromium camera test.");
  await installSyntheticCamera(page);
  await startCameraScan(page);
  await page.getByLabel("Auto capture").uncheck();
  await page.getByRole("button", { name: "Capture manually" }).click();
  await expect(page.getByRole("heading", { name: "R · Right" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel("F recognized sticker preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use this capture anyway" })).toHaveCount(0);
});

test("portrait scan geometry stays fixed for the complete F through D sequence", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start scanning" }).click();
  await page.getByRole("button", { name: "Use image files instead" }).click();
  await expect(page.getByRole("heading", { name: "F · Front" })).toBeVisible();
  const initial = await scanGeometry(page);

  const steps = [["F", "R · Right"], ["R", "B · Back"], ["B", "L · Left"], ["L", "U · Up"], ["U", "D · Down"]] as const;
  for (const [face, nextHeading] of steps) {
    await uploadSyntheticFace(page, face);
    await expect(page.getByRole("heading", { name: nextHeading })).toBeVisible({ timeout: 15_000 });
    expectSameGeometry(await scanGeometry(page), initial);
    await expect(page.locator(".scan-progress .current")).toHaveText(nextHeading[0]);
    await expect(page.locator(".scan-progress .done")).toHaveCount(SCAN_ORDER_INDEX[face] + 1);
  }
  await uploadSyntheticFace(page, "D");
  await expect(page.getByText(/Move 1 of/)).toBeVisible({ timeout: 20_000 });
});

test("an invalid six-face scan enters targeted recovery and preserves every preview", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Canvas MediaStream injection is the deterministic Chromium camera test.");
  await installSyntheticCamera(page, INVALID_SCANS);
  await startCameraScan(page);
  const initial = await scanGeometry(page);
  for (const [face, nextHeading] of [["F", "R · Right"], ["R", "B · Back"], ["B", "L · Left"], ["L", "U · Up"], ["U", "D · Down"], ["D", "Check the highlighted faces"]] as const) {
    await page.evaluate((nextFace) => (window as unknown as { setSyntheticFace: (value: string) => void }).setSyntheticFace(nextFace), face);
    await expect(page.getByRole("heading", { name: nextHeading })).toBeVisible({ timeout: 20_000 });
    if (face !== "D") expectSameGeometry(await scanGeometry(page), initial);
  }
  await expect(page.locator("article.captured-face")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Advanced correction" })).toBeVisible();
  const frontPreview = page.locator('article.captured-face[data-face="F"]');
  await frontPreview.getByRole("button", { name: "Retake" }).click();
  await expect(page.getByRole("heading", { name: "Retake F" })).toBeVisible();
  await page.evaluate((colors) => (window as unknown as {
    setSyntheticFaceColors: (face: string, values: string[]) => void;
  }).setSyntheticFaceColors("F", colors), [...SCANS.F]);
  await page.getByRole("button", { name: "Start camera to retake" }).click();
  await expect(page.getByRole("heading", { name: "F · Front" })).toBeVisible();
  await expect(page.locator("article.captured-face")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Start camera guidance" })).toBeVisible({ timeout: 20_000 });
});
