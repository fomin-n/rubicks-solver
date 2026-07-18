from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
TARGET_SIZE = 768


class ImageProcessingError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class StickerSample:
    lab: tuple[float, float, float]
    preview_hex: str
    consistency: float


@dataclass(frozen=True, slots=True)
class QualityReport:
    blur_score: float
    underexposed_fraction: float
    overexposed_fraction: float
    glare_fraction: float
    warnings: tuple[str, ...]
    retake_recommended: bool


@dataclass(frozen=True, slots=True)
class ProcessedFace:
    samples: tuple[StickerSample, StickerSample, StickerSample, StickerSample]
    quality: QualityReport


def _decode_image(data: bytes) -> np.ndarray:
    if not data:
        raise ImageProcessingError("The uploaded image is empty.")
    encoded = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None:
        raise ImageProcessingError("The uploaded file is not a supported image.")
    height, width = image.shape[:2]
    if height < 160 or width < 160:
        raise ImageProcessingError("The image is too small; use at least 160×160 pixels.")
    if height * width > MAX_IMAGE_PIXELS:
        raise ImageProcessingError("The decoded image is too large.")
    scale = min(1.0, TARGET_SIZE / max(height, width))
    if scale < 1:
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return cv2.resize(image, (TARGET_SIZE, TARGET_SIZE), interpolation=cv2.INTER_AREA)


def _opencv_lab_to_cie(values: np.ndarray) -> np.ndarray:
    result = values.astype(np.float32)
    result[..., 0] *= 100.0 / 255.0
    result[..., 1:] -= 128.0
    return result


def _sample_patch(image: np.ndarray, row: int, column: int) -> StickerSample:
    cell = TARGET_SIZE // 2
    margin = int(cell * 0.20)
    y0, y1 = row * cell + margin, (row + 1) * cell - margin
    x0, x1 = column * cell + margin, (column + 1) * cell - margin
    patch = image[y0:y1, x0:x1]
    rgb = cv2.cvtColor(patch, cv2.COLOR_BGR2RGB)
    glare_mask = np.max(rgb, axis=2) < 250
    pixels = rgb[glare_mask]
    if len(pixels) < patch.shape[0] * patch.shape[1] * 0.4:
        pixels = rgb.reshape(-1, 3)
    median_rgb = np.median(pixels, axis=0).astype(np.uint8)
    median_bgr = median_rgb[::-1].reshape(1, 1, 3)
    median_lab = _opencv_lab_to_cie(cv2.cvtColor(median_bgr, cv2.COLOR_BGR2LAB))[0, 0]

    patch_lab = _opencv_lab_to_cie(cv2.cvtColor(patch, cv2.COLOR_BGR2LAB))
    distances = np.linalg.norm(patch_lab - median_lab, axis=2)
    consistency = float(np.median(distances))
    preview_hex = "#" + "".join(f"{channel:02x}" for channel in median_rgb)
    return StickerSample(tuple(float(value) for value in median_lab), preview_hex, consistency)


def process_face_image(data: bytes) -> ProcessedFace:
    image = _decode_image(data)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    underexposed = float(np.mean(gray < 25))
    overexposed = float(np.mean(gray > 242))
    glare = float(np.mean(np.max(image, axis=2) > 250))
    samples = tuple(_sample_patch(image, row, column) for row in range(2) for column in range(2))
    spread = max(sample.consistency for sample in samples)

    warnings: list[str] = []
    severe = False
    if blur_score < 50:
        warnings.append("The face looks blurry. Hold the cube and camera steady.")
        severe = blur_score < 25
    if underexposed > 0.25:
        warnings.append("The image is too dark. Add diffuse light and retake it.")
        severe = True
    if overexposed > 0.25 or glare > 0.15:
        warnings.append("Strong glare or overexposure may hide sticker colors.")
        severe = True
    if spread > 18:
        warnings.append("A sticker region has inconsistent color; check alignment and reflections.")
        severe = severe or spread > 28
    return ProcessedFace(
        samples,
        QualityReport(blur_score, underexposed, overexposed, glare, tuple(warnings), severe),
    )
