from __future__ import annotations

from io import BytesIO

import cv2
import numpy as np
import pytest
from PIL import Image

from app.vision.processing import ImageProcessingError, process_face_image


def _face_image(exposure: float = 1.0) -> bytes:
    image = np.zeros((600, 600, 3), dtype=np.uint8)
    colors = ((30, 30, 210), (30, 170, 40), (210, 80, 20), (20, 210, 240))
    for index, color in enumerate(colors):
        row, column = divmod(index, 2)
        adjusted = np.clip(np.asarray(color) * exposure, 0, 255).astype(np.uint8)
        image[row * 300 : (row + 1) * 300, column * 300 : (column + 1) * 300] = adjusted
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()


def _face_with_dark_borders() -> bytes:
    image = np.zeros((600, 600, 3), dtype=np.uint8)
    colors = ((30, 30, 150), (35, 110, 30), (130, 45, 25), (25, 140, 155))
    for index, color in enumerate(colors):
        row, column = divmod(index, 2)
        image[
            row * 300 + 60 : (row + 1) * 300 - 60,
            column * 300 + 60 : (column + 1) * 300 - 60,
        ] = color
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()


def _blurred_face(kernel: int) -> bytes:
    source = cv2.imdecode(np.frombuffer(_face_image(), dtype=np.uint8), cv2.IMREAD_COLOR)
    image = cv2.GaussianBlur(source, (kernel, kernel), 0)
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()


def test_samples_four_regions():
    processed = process_face_image(_face_image())
    assert len(processed.samples) == 4
    assert len({sample.preview_hex for sample in processed.samples}) == 4
    assert not processed.quality.retake_recommended


@pytest.mark.parametrize("exposure", [0.7, 0.5, 0.35])
def test_moderately_dark_faces_remain_usable(exposure: float):
    processed = process_face_image(_face_image(exposure))
    assert len({sample.preview_hex for sample in processed.samples}) == 4
    assert not processed.quality.retake_recommended
    assert not processed.quality.blocking_reasons
    if exposure <= 0.5:
        assert any("lower than recommended" in warning for warning in processed.quality.warnings)


def test_near_black_sticker_regions_are_blocked():
    processed = process_face_image(_face_image(0.06))
    assert processed.quality.retake_recommended
    assert "too_dark" in processed.quality.blocking_reasons
    assert processed.quality.sticker_median_brightness < 22


def test_dark_outer_pixels_do_not_override_usable_sticker_regions():
    processed = process_face_image(_face_with_dark_borders())
    assert processed.quality.full_image_underexposed_fraction > 0.5
    assert processed.quality.underexposed_fraction < 0.05
    assert "too_dark" not in processed.quality.blocking_reasons


def test_moderate_softness_warns_without_blocking_recognition():
    processed = process_face_image(_blurred_face(31))
    assert len(processed.samples) == 4
    assert "blurry" not in processed.quality.blocking_reasons
    assert processed.quality.retake_recommended is False


def test_structured_quality_codes_are_deduplicated():
    processed = process_face_image(_face_image(0.35))
    assert len(processed.quality.warning_codes) == len(set(processed.quality.warning_codes))
    assert "low_light" in processed.quality.warning_codes


def test_rejects_invalid_image():
    try:
        process_face_image(b"not an image")
    except ImageProcessingError as error:
        assert "supported image" in str(error)
    else:
        raise AssertionError("Invalid bytes were accepted")


def test_applies_exif_orientation_before_sampling():
    rgb = np.zeros((400, 400, 3), dtype=np.uint8)
    rgb[:200, :200] = (230, 30, 30)
    rgb[:200, 200:] = (30, 230, 30)
    rgb[200:, :200] = (30, 30, 230)
    rgb[200:, 200:] = (230, 220, 30)
    image = Image.fromarray(rgb)
    exif = image.getexif()
    exif[274] = 6
    output = BytesIO()
    image.save(output, format="JPEG", quality=95, exif=exif)

    previews = [sample.preview_hex for sample in process_face_image(output.getvalue()).samples]
    red, green, blue = (int(previews[0][offset : offset + 2], 16) for offset in (1, 3, 5))
    assert red < 50 and green < 50 and blue > 180
