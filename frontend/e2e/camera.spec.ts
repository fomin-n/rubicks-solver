import { expect, test, type Page } from "@playwright/test";

const SCANS = {
  F: ["red", "green", "orange", "orange"],
  R: ["orange", "green", "white", "blue"],
  B: ["red", "white", "yellow", "blue"],
  L: ["red", "yellow", "orange", "white"],
  U: ["blue", "white", "green", "yellow"],
  D: ["blue", "green", "yellow", "red"],
} as const;
const INVALID_SCANS = { ...SCANS, F: ["green", "red", "orange", "orange"] } as const;
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
    const draw = (face: keyof typeof injectedScans) => {
      currentFace = face;
      injectedScans[face].forEach((color, index) => {
        context.fillStyle = colors[color];
        context.fillRect(index % 2 * 320, Math.floor(index / 2) * 320, 320, 320);
      });
      // Keep the scene-change signal pending until the analyzer has actually
      // observed it. Backend processing can outlast the capture cooldown.
      changedFrames = 8;
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
      getUserMedia: async () => canvas.captureStream(12),
      enumerateDevices: async () => [{ deviceId: "synthetic", kind: "videoinput", label: "Synthetic rear camera", groupId: "synthetic", toJSON: () => ({}) }],
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

test("physical-frame auto capture previews, retakes, solves directly, and guides safely", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Canvas MediaStream injection is the deterministic Chromium camera test.");
  await installSyntheticCamera(page);
  await startCameraScan(page);

  await page.evaluate(() => (window as unknown as { setSyntheticFace: (face: string) => void }).setSyntheticFace("F"));
  await expect(page.getByRole("heading", { name: "R · Right" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Captured faces", { exact: true })).toBeVisible();
  await expect(page.getByLabel("F recognized sticker preview").locator("span")).toHaveCount(4);
  await expect(page.getByText("smoothedMotion", { exact: false })).toBeVisible();

  await page.evaluate(() => (window as unknown as { setSyntheticFace: (face: string) => void }).setSyntheticFace("R"));
  await expect(page.getByRole("heading", { name: "B · Back" })).toBeVisible({ timeout: 15_000 });
  const frontPreview = page.locator('article.captured-face[data-face="F"]');
  await frontPreview.getByRole("button", { name: "Retake" }).click();
  await expect(page.getByRole("heading", { name: "F · Front" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Cube solved" })).toBeVisible();
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

test("an invalid six-face scan enters targeted recovery and preserves every preview", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Canvas MediaStream injection is the deterministic Chromium camera test.");
  await installSyntheticCamera(page, INVALID_SCANS);
  await startCameraScan(page);
  for (const [face, nextHeading] of [["F", "R · Right"], ["R", "B · Back"], ["B", "L · Left"], ["L", "U · Up"], ["U", "D · Down"], ["D", "Check the highlighted faces"]] as const) {
    await page.evaluate((nextFace) => (window as unknown as { setSyntheticFace: (value: string) => void }).setSyntheticFace(nextFace), face);
    await expect(page.getByRole("heading", { name: nextHeading })).toBeVisible({ timeout: 20_000 });
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
