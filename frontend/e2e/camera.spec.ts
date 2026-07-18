import { expect, test } from "@playwright/test";

const SCANS = {
  F: ["red", "green", "orange", "orange"],
  R: ["orange", "green", "white", "blue"],
  B: ["red", "white", "yellow", "blue"],
  L: ["red", "yellow", "orange", "white"],
  U: ["blue", "white", "green", "yellow"],
  D: ["blue", "green", "yellow", "red"],
} as const;

test("automatic capture scans six synthetic camera faces", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Canvas MediaStream injection is the deterministic Chromium camera test.");
  await page.addInitScript(({ scans }) => {
    const colors: Record<string, string> = { red: "#d72d3d", blue: "#2468ce", orange: "#e87918", white: "#e4e7df", green: "#24a665", yellow: "#dfc525" };
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 640;
    const context = canvas.getContext("2d")!;
    let currentFace: keyof typeof scans = "F";
    let changedUntil = 0;
    const draw = (face: keyof typeof scans) => {
      currentFace = face;
      scans[face].forEach((color, index) => {
        context.fillStyle = colors[color];
        context.fillRect(index % 2 * 320, Math.floor(index / 2) * 320, 320, 320);
      });
      changedUntil = performance.now() + 1_200;
    };
    const stream = canvas.captureStream(12);
    draw("F");
    changedUntil = 0;
    (window as unknown as { setSyntheticFace: (face: keyof typeof scans) => void }).setSyntheticFace = draw;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: async () => stream,
      enumerateDevices: async () => [{ deviceId: "synthetic", kind: "videoinput", label: "Synthetic rear camera", groupId: "synthetic", toJSON: () => ({}) }],
    } });
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: () => true });
    (window as unknown as { __rubiksE2ECamera: object }).__rubiksE2ECamera = {
      metrics: () => ({ brightness: 130, darkFraction: 0.01, glareFraction: 0.01, sharpness: 24, motion: performance.now() < changedUntil ? 10 : 1, quadrantConsistency: 4, boundaryStrength: 45, alignmentScore: 0.82 }),
      captureBlob: () => new Promise<Blob>((resolve) => {
        const output = document.createElement("canvas");
        output.width = 640;
        output.height = 640;
        const outputContext = output.getContext("2d")!;
        outputContext.fillStyle = "#121212";
        outputContext.fillRect(0, 0, 640, 640);
        scans[currentFace].forEach((color, index) => {
          outputContext.fillStyle = colors[color];
          outputContext.fillRect(index % 2 * 320 + 12, Math.floor(index / 2) * 320 + 12, 296, 296);
        });
        output.toBlob((blob) => resolve(blob!), "image/jpeg", 0.95);
      }),
    };
  }, { scans: SCANS });

  await page.goto("/");
  await page.getByRole("button", { name: "Start scanning" }).click();
  await page.getByRole("button", { name: "Allow camera" }).click();
  await expect(page.getByRole("heading", { name: "F · Front" })).toBeVisible();
  await page.evaluate(() => (window as unknown as { setSyntheticFace: (face: string) => void }).setSyntheticFace("F"));
  const syntheticRed = await page.evaluate(async () => {
    const blob = await (window as unknown as { __rubiksE2ECamera: { captureBlob: () => Promise<Blob> } }).__rubiksE2ECamera.captureBlob();
    const bitmap = await createImageBitmap(blob);
    const sample = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = sample.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    return [...context.getImageData(160, 160, 1, 1).data];
  });
  expect(syntheticRed[0]).toBeGreaterThan(150);
  for (const [face, name] of [["R", "Right"], ["B", "Back"], ["L", "Left"], ["U", "Up"], ["D", "Down"]] as const) {
    await expect(page.getByRole("heading", { name: `${face} · ${name}` })).toBeVisible({ timeout: 15_000 });
    await page.evaluate((nextFace) => (window as unknown as { setSyntheticFace: (face: string) => void }).setSyntheticFace(nextFace), face);
  }
  await expect(page.getByRole("heading", { name: "Check every facelet" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Validate and solve" }).click();
  await expect(page.getByRole("button", { name: "Start camera guidance" })).toBeVisible();
  await page.getByRole("button", { name: "Start camera guidance" }).click();
  await page.getByRole("button", { name: "Orientation matched" }).click();
  const moveLabel = page.getByText(/Move 1 of/);
  await expect(moveLabel).toBeVisible();
  const total = Number((await moveLabel.textContent())?.match(/of (\d+)/)?.[1]);
  expect(total).toBeGreaterThan(0);
  for (let index = 0; index < total; index += 1) await page.getByRole("button", { name: "Done / Next" }).click();
  await expect(page.getByRole("heading", { name: "Cube solved" })).toBeVisible();
});
