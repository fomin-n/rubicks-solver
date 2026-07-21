import { analyzePixels, STICKER_ROI_MARGIN } from "../src/camera/analyzer";
import { AUTO_CAPTURE_CONFIG, evaluateMetrics } from "../src/camera/autoCapture";

function stickerFrame(colors: [number, number, number][]): Uint8ClampedArray {
  const side = 240;
  const cell = side / 2;
  const margin = cell * STICKER_ROI_MARGIN;
  const data = new Uint8ClampedArray(side * side * 4);
  for (let pixel = 0; pixel < side * side; pixel += 1) data[pixel * 4 + 3] = 255;
  colors.forEach((color, index) => {
    const row = Math.floor(index / 2);
    const column = index % 2;
    for (let y = row * cell + margin; y < (row + 1) * cell - margin; y += 1) {
      for (let x = column * cell + margin; x < (column + 1) * cell - margin; x += 1) {
        const offset = (y * side + x) * 4;
        [data[offset], data[offset + 1], data[offset + 2]] = color;
      }
    }
  });
  return data;
}

describe("capture analyzer lighting ROI", () => {
  it("excludes dark borders and seams from sticker lighting metrics", () => {
    const pixels = stickerFrame([[115, 25, 25], [25, 55, 130], [20, 100, 35], [110, 30, 30]]);
    const analysis = analyzePixels(pixels, analyzePixels(pixels).luma);
    expect(analysis.metrics.fullCropDarkFraction).toBeGreaterThan(0.5);
    expect(analysis.metrics.darkFraction).toBeLessThan(0.05);
    expect(analysis.metrics.faceStructureScore).toBeGreaterThan(AUTO_CAPTURE_CONFIG.hardMinFaceStructure);
    expect(analysis.metrics.brightness).toBeGreaterThan(AUTO_CAPTURE_CONFIG.hardMinBrightness);
    const evaluation = evaluateMetrics({ ...analysis.metrics, sharpness: 24, alignmentScore: 0.8 });
    expect(evaluation.blockingReason).not.toBe("too_dark");
  });

  it("still identifies near-black sticker regions", () => {
    const pixels = stickerFrame(Array.from({ length: 4 }, () => [8, 8, 8] as [number, number, number]));
    const analysis = analyzePixels(pixels, analyzePixels(pixels).luma);
    expect(analysis.metrics.brightness).toBeLessThan(AUTO_CAPTURE_CONFIG.hardMinBrightness);
    expect(analysis.metrics.darkFraction).toBeGreaterThan(0.9);
    expect(evaluateMetrics({ ...analysis.metrics, sharpness: 24, alignmentScore: 0.8 }).blockingReason).toBe("too_dark");
  });

  it("rejects a uniform hand/background region without black face geometry", () => {
    const pixels = new Uint8ClampedArray(240 * 240 * 4);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      pixels[offset] = 205;
      pixels[offset + 1] = 160;
      pixels[offset + 2] = 140;
      pixels[offset + 3] = 255;
    }
    const analysis = analyzePixels(pixels, analyzePixels(pixels).luma);
    expect(analysis.metrics.faceStructureScore).toBeLessThan(AUTO_CAPTURE_CONFIG.hardMinFaceStructure);
    expect(evaluateMetrics({ ...analysis.metrics, sharpness: 24, motion: 0 }).blockingReason).toBe("center_cube");
  });
});
