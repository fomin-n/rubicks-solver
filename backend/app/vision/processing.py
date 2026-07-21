from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
TARGET_SIZE = 768
STICKER_ROI_MARGIN = 0.20
BLACK_PLASTIC_VALUE_MAX = 65
FACE_STRUCTURE_MIN = 0.30
LOW_LIGHT_WARNING_MEDIAN = 55
EXTREME_DARK_MEDIAN = 22
LOW_LIGHT_WARNING_DARK_FRACTION = 0.25
EXTREME_DARK_FRACTION = 0.75


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
    boundary_score: float
    underexposed_fraction: float
    full_image_underexposed_fraction: float
    sticker_median_brightness: float
    overexposed_fraction: float
    glare_fraction: float
    border_dark_fraction: float
    separator_dark_fraction: float
    sticker_dark_fraction: float
    face_structure_score: float
    warnings: tuple[str, ...]
    warning_codes: tuple[str, ...]
    blocking_reasons: tuple[str, ...]
    retake_recommended: bool


@dataclass(frozen=True, slots=True)
class ProcessedFace:
    samples: tuple[StickerSample, StickerSample, StickerSample, StickerSample]
    quality: QualityReport


def _decode_image(data: bytes) -> np.ndarray:
    if not data:
        raise ImageProcessingError("The uploaded image is empty.")
    try:
        with Image.open(BytesIO(data)) as source:
            width, height = source.size
            if height * width > MAX_IMAGE_PIXELS:
                raise ImageProcessingError("The decoded image is too large.")
            transposed = ImageOps.exif_transpose(source)
            rgb = transposed.convert("RGB")
            rgb.load()
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise ImageProcessingError("The uploaded file is not a supported image.") from error
    height, width = rgb.height, rgb.width
    if height < 160 or width < 160:
        raise ImageProcessingError("The image is too small; use at least 160×160 pixels.")
    image = cv2.cvtColor(np.asarray(rgb), cv2.COLOR_RGB2BGR)
    scale = min(1.0, TARGET_SIZE / max(height, width))
    if scale < 1:
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return image


def _rectangle_fraction(integral: np.ndarray, x0: float, y0: float, x1: float, y1: float) -> float:
    left, top = int(x0), int(y0)
    right, bottom = int(x1), int(y1)
    total = (
        integral[bottom, right]
        - integral[top, right]
        - integral[bottom, left]
        + integral[top, left]
    )
    return float(total / max(1, (right - left) * (bottom - top)))


def _candidate_structure(
    integral: np.ndarray, x: int, y: int, size: int
) -> tuple[float, float, float, float]:
    border = size * 0.06
    separator = size * 0.035
    cell = size / 2
    margin = cell * STICKER_ROI_MARGIN
    border_dark = float(
        np.mean(
            [
                _rectangle_fraction(integral, x, y, x + size, y + border),
                _rectangle_fraction(integral, x, y + size - border, x + size, y + size),
                _rectangle_fraction(integral, x, y + border, x + border, y + size - border),
                _rectangle_fraction(
                    integral, x + size - border, y + border, x + size, y + size - border
                ),
            ]
        )
    )
    separator_dark = float(
        np.mean(
            [
                _rectangle_fraction(
                    integral,
                    x + size / 2 - separator,
                    y + border,
                    x + size / 2 + separator,
                    y + size - border,
                ),
                _rectangle_fraction(
                    integral,
                    x + border,
                    y + size / 2 - separator,
                    x + size - border,
                    y + size / 2 + separator,
                ),
            ]
        )
    )
    sticker_dark = float(
        np.mean(
            [
                _rectangle_fraction(
                    integral,
                    x + column * cell + margin,
                    y + row * cell + margin,
                    x + (column + 1) * cell - margin,
                    y + (row + 1) * cell - margin,
                )
                for row in range(2)
                for column in range(2)
            ]
        )
    )
    score = float(np.clip(0.42 * border_dark + 0.52 * separator_dark - 0.28 * sticker_dark, 0, 1))
    return score, border_dark, separator_dark, sticker_dark


def _black_plastic_integral(image: np.ndarray) -> np.ndarray:
    value = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)[..., 2]
    return cv2.integral((value < BLACK_PLASTIC_VALUE_MAX).astype(np.uint8))


def _locate_face(image: np.ndarray) -> np.ndarray:
    """Find this cube's black square 2x2 frame in a contextual upload.

    Live camera captures are already square guide crops and stay pixel-aligned.
    Portrait reference/file uploads are searched for the strongest black outer
    border plus central cross, which ignores the surrounding hand/background.
    """
    height, width = image.shape[:2]
    if 0.92 <= width / height <= 1.08:
        return cv2.resize(image, (TARGET_SIZE, TARGET_SIZE), interpolation=cv2.INTER_AREA)

    integral = _black_plastic_integral(image)
    shortest = min(height, width)
    step = max(4, round(shortest * 0.012))
    best: tuple[float, int, int, int] | None = None
    for scale in np.arange(0.50, 0.861, 0.025):
        size = round(shortest * scale)
        if height >= width:
            x_range = range(0, width - size + 1, step)
            y_start, y_stop = round(height * 0.23), min(height - size, round(height * 0.70))
            y_range = range(max(0, y_start), max(0, y_stop) + 1, step)
        else:
            y_range = range(0, height - size + 1, step)
            x_start, x_stop = round(width * 0.15), min(width - size, round(width * 0.85))
            x_range = range(max(0, x_start), max(0, x_stop) + 1, step)
        for y in y_range:
            for x in x_range:
                score, _, _, _ = _candidate_structure(integral, x, y, size)
                center_penalty = (
                    abs(x + size / 2 - width / 2) / width
                    + abs(y + size / 2 - height / 2) / height * 0.25
                ) * 0.12
                candidate = (score - center_penalty, x, y, size)
                if best is None or candidate[0] > best[0]:
                    best = candidate
    if best is None:
        side = shortest
        x, y = (width - side) // 2, (height - side) // 2
    else:
        _, x, y, side = best
    return cv2.resize(
        image[y : y + side, x : x + side],
        (TARGET_SIZE, TARGET_SIZE),
        interpolation=cv2.INTER_AREA,
    )


def _opencv_lab_to_cie(values: np.ndarray) -> np.ndarray:
    result = values.astype(np.float32)
    result[..., 0] *= 100.0 / 255.0
    result[..., 1:] -= 128.0
    return result


def _sticker_patch(image: np.ndarray, row: int, column: int) -> np.ndarray:
    cell = TARGET_SIZE // 2
    margin = int(cell * STICKER_ROI_MARGIN)
    y0, y1 = row * cell + margin, (row + 1) * cell - margin
    x0, x1 = column * cell + margin, (column + 1) * cell - margin
    return image[y0:y1, x0:x1]


def _sample_patch(image: np.ndarray, row: int, column: int) -> StickerSample:
    patch = _sticker_patch(image, row, column)
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
    image = _locate_face(_decode_image(data))
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    raw_blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    patches = tuple(_sticker_patch(image, row, column) for row in range(2) for column in range(2))
    sticker_pixels = np.concatenate([patch.reshape(-1, 3) for patch in patches])
    sticker_gray = cv2.cvtColor(sticker_pixels.reshape(-1, 1, 3), cv2.COLOR_BGR2GRAY).reshape(-1)
    full_image_underexposed = float(np.mean(gray < 25))
    underexposed = float(np.mean(sticker_gray < 25))
    sticker_median_brightness = float(np.median(sticker_gray))
    exposure_scale = max(1.0, min(4.0, 100.0 / max(sticker_median_brightness, 22.0)))
    blur_score = raw_blur_score * exposure_scale**2
    seam = TARGET_SIZE // 2
    boundary_score = float(
        (
            np.mean(np.abs(gray[:, seam + 2].astype(float) - gray[:, seam - 2].astype(float)))
            + np.mean(np.abs(gray[seam + 2].astype(float) - gray[seam - 2].astype(float)))
        )
        / 2
        * exposure_scale
    )
    overexposed = float(np.mean(sticker_gray > 242))
    glare = float(np.mean(np.max(sticker_pixels, axis=1) > 250))
    structure = _candidate_structure(_black_plastic_integral(image), 0, 0, TARGET_SIZE)
    face_structure_score, border_dark, separator_dark, sticker_dark = structure
    samples = tuple(_sample_patch(image, row, column) for row in range(2) for column in range(2))
    spread = max(sample.consistency for sample in samples)
    sample_values = np.array([sample.lab for sample in samples])
    sample_separation = float(
        max(
            np.linalg.norm(sample_values[left] - sample_values[right])
            for left in range(4)
            for right in range(left + 1, 4)
        )
    )

    warnings: list[str] = []
    warning_codes: list[str] = []
    blocking_reasons: list[str] = []
    if face_structure_score < FACE_STRUCTURE_MIN:
        warning_codes.append("not_cube")
        warnings.append("The guide does not contain a complete 2x2 face with black separators.")
        blocking_reasons.append("not_cube")
    if blur_score < 35:
        warning_codes.append("soft_focus")
        warnings.append("The face is slightly soft, but its sticker samples remain usable.")
        if blur_score < 8 and boundary_score < 2 and (spread > 28 or sample_separation < 3):
            blocking_reasons.append("blurry")
    if sticker_median_brightness < EXTREME_DARK_MEDIAN or underexposed > EXTREME_DARK_FRACTION:
        warning_codes.append("too_dark")
        warnings.append("The sticker regions are too dark to identify reliably.")
        blocking_reasons.append("too_dark")
    elif (
        sticker_median_brightness < LOW_LIGHT_WARNING_MEDIAN
        or underexposed > LOW_LIGHT_WARNING_DARK_FRACTION
    ):
        warning_codes.append("low_light")
        warnings.append("Lighting is lower than recommended, but sticker colors remain usable.")
    if overexposed > 0.25 or glare > 0.15:
        warning_codes.append("glare")
        warnings.append("Strong glare or overexposure may hide sticker colors.")
        blocking_reasons.append("glare")
    if spread > 18:
        warning_codes.append("inconsistent")
        warnings.append("A sticker region has inconsistent color; check alignment and reflections.")
        if spread > 28:
            blocking_reasons.append("inconsistent")
    return ProcessedFace(
        samples,
        QualityReport(
            blur_score,
            boundary_score,
            underexposed,
            full_image_underexposed,
            sticker_median_brightness,
            overexposed,
            glare,
            border_dark,
            separator_dark,
            sticker_dark,
            face_structure_score,
            tuple(warnings),
            tuple(warning_codes),
            tuple(blocking_reasons),
            bool(blocking_reasons),
        ),
    )
