import { AUTO_CAPTURE_CONFIG, type CaptureMetrics } from "./autoCapture";

export interface FrameAnalysis {
  metrics: CaptureMetrics;
  luma: Uint8Array;
}

export const STICKER_ROI_MARGIN = 0.2;

function histogramPercentile(histogram: Uint32Array, count: number, percentile: number): number {
  const target = Math.max(0, Math.ceil(count * percentile) - 1);
  let seen = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value];
    if (seen > target) return value;
  }
  return 0;
}

export function analyzePixels(data: Uint8ClampedArray, previous?: Uint8Array): FrameAnalysis {
  const pixelCount = data.length / 4;
  const side = Math.round(Math.sqrt(pixelCount));
  const luma = new Uint8Array(pixelCount);
  let fullTotal = 0;
  let fullDark = 0;
  let stickerDark = 0;
  let stickerGlare = 0;
  let stickerCount = 0;
  let motion = 0;
  let gradients = 0;
  let gradientCount = 0;
  const quadrantTotals = [0, 0, 0, 0];
  const quadrantSquares = [0, 0, 0, 0];
  const quadrantCounts = [0, 0, 0, 0];
  const quadrantHistograms = Array.from({ length: 4 }, () => new Uint32Array(256));
  const stickerHistogram = new Uint32Array(256);
  const cellSize = side / 2;
  const roiMargin = cellSize * STICKER_ROI_MARGIN;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const value = Math.round(data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114);
    luma[pixel] = value;
    fullTotal += value;
    if (value < 25) fullDark += 1;
    if (previous?.length === pixelCount) motion += Math.abs(value - previous[pixel]);
    const row = Math.floor(pixel / side);
    const column = pixel % side;
    const quadrant = (row >= side / 2 ? 2 : 0) + (column >= side / 2 ? 1 : 0);
    const localRow = row % cellSize;
    const localColumn = column % cellSize;
    const inStickerRoi = localRow >= roiMargin && localRow < cellSize - roiMargin
      && localColumn >= roiMargin && localColumn < cellSize - roiMargin;
    if (inStickerRoi) {
      stickerCount += 1;
      if (value < 25) stickerDark += 1;
      if (Math.max(data[offset], data[offset + 1], data[offset + 2]) > 248) stickerGlare += 1;
      stickerHistogram[value] += 1;
      quadrantHistograms[quadrant][value] += 1;
      quadrantTotals[quadrant] += value;
      quadrantSquares[quadrant] += value * value;
      quadrantCounts[quadrant] += 1;
    }
    if (column > 0) { gradients += Math.abs(value - luma[pixel - 1]); gradientCount += 1; }
    if (row > 0) { gradients += Math.abs(value - luma[pixel - side]); gradientCount += 1; }
  }

  const seam = Math.floor(side / 2);
  let boundary = 0;
  for (let index = 0; index < side; index += 1) {
    boundary += Math.abs(luma[index * side + seam] - luma[index * side + seam - 1]);
    boundary += Math.abs(luma[seam * side + index] - luma[(seam - 1) * side + index]);
  }
  const boundaryStrength = boundary / Math.max(1, side * 2);
  const rawSharpness = Math.max(gradients / Math.max(1, gradientCount), boundaryStrength * 0.18);
  const patchMedians = quadrantHistograms.map((histogram, index) => (
    histogramPercentile(histogram, quadrantCounts[index], 0.5)
  )).sort((a, b) => a - b);
  const stickerMedianBrightness = (patchMedians[1] + patchMedians[2]) / 2;
  const exposureScale = Math.max(1, Math.min(4, 100 / Math.max(stickerMedianBrightness, AUTO_CAPTURE_CONFIG.hardMinBrightness)));
  const sharpness = rawSharpness * exposureScale;
  const quadrantConsistency = quadrantTotals.reduce((sum, value, index) => {
    const mean = value / quadrantCounts[index];
    return sum + Math.sqrt(Math.max(0, quadrantSquares[index] / quadrantCounts[index] - mean * mean));
  }, 0) / 4;
  const alignmentScore = Math.max(0, Math.min(1, 0.58 + boundaryStrength / 100 - quadrantConsistency / 220));
  return {
    luma,
    metrics: {
      fullCropBrightness: fullTotal / pixelCount,
      fullCropDarkFraction: fullDark / pixelCount,
      brightness: stickerMedianBrightness,
      lowerBrightnessPercentile: histogramPercentile(stickerHistogram, stickerCount, 0.1),
      darkFraction: stickerDark / Math.max(1, stickerCount),
      glareFraction: stickerGlare / Math.max(1, stickerCount),
      sharpness,
      motion: previous?.length === pixelCount ? motion / pixelCount : AUTO_CAPTURE_CONFIG.sceneChangeMotion,
      quadrantConsistency,
      boundaryStrength,
      alignmentScore,
    },
  };
}
