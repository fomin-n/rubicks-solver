import { AUTO_CAPTURE_CONFIG, type CaptureMetrics } from "./autoCapture";

export interface FrameAnalysis {
  metrics: CaptureMetrics;
  luma: Uint8Array;
}

export function analyzePixels(data: Uint8ClampedArray, previous?: Uint8Array): FrameAnalysis {
  const pixelCount = data.length / 4;
  const side = Math.round(Math.sqrt(pixelCount));
  const luma = new Uint8Array(pixelCount);
  let total = 0;
  let dark = 0;
  let glare = 0;
  let motion = 0;
  let gradients = 0;
  let gradientCount = 0;
  const quadrantTotals = [0, 0, 0, 0];
  const quadrantSquares = [0, 0, 0, 0];
  const quadrantCounts = [0, 0, 0, 0];

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const value = Math.round(data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114);
    luma[pixel] = value;
    total += value;
    if (value < 35) dark += 1;
    if (Math.max(data[offset], data[offset + 1], data[offset + 2]) > 248) glare += 1;
    if (previous?.length === pixelCount) motion += Math.abs(value - previous[pixel]);
    const row = Math.floor(pixel / side);
    const column = pixel % side;
    const quadrant = (row >= side / 2 ? 2 : 0) + (column >= side / 2 ? 1 : 0);
    quadrantTotals[quadrant] += value;
    quadrantSquares[quadrant] += value * value;
    quadrantCounts[quadrant] += 1;
    if (column > 0) { gradients += Math.abs(value - luma[pixel - 1]); gradientCount += 1; }
    if (row > 0) { gradients += Math.abs(value - luma[pixel - side]); gradientCount += 1; }
  }

  const seam = Math.floor(side / 2);
  let boundary = 0;
  for (let index = 0; index < side; index += 1) {
    boundary += Math.abs(luma[index * side + seam] - luma[index * side + seam - 1]);
    boundary += Math.abs(luma[seam * side + index] - luma[(seam - 1) * side + index]);
  }
  const sharpness = gradients / Math.max(1, gradientCount);
  const boundaryStrength = boundary / Math.max(1, side * 2);
  const quadrantConsistency = quadrantTotals.reduce((sum, value, index) => {
    const mean = value / quadrantCounts[index];
    return sum + Math.sqrt(Math.max(0, quadrantSquares[index] / quadrantCounts[index] - mean * mean));
  }, 0) / 4;
  const alignmentScore = Math.max(0, Math.min(1, 0.58 + boundaryStrength / 100 - quadrantConsistency / 220));
  return {
    luma,
    metrics: {
      brightness: total / pixelCount,
      darkFraction: dark / pixelCount,
      glareFraction: glare / pixelCount,
      sharpness,
      motion: previous?.length === pixelCount ? motion / pixelCount : AUTO_CAPTURE_CONFIG.sceneChangeMotion,
      quadrantConsistency,
      boundaryStrength,
      alignmentScore,
    },
  };
}
