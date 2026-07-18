from __future__ import annotations

from io import BytesIO

import cv2
import numpy as np
from PIL import Image

from app.vision.processing import ImageProcessingError, process_face_image


def _face_image() -> bytes:
    image = np.zeros((600, 600, 3), dtype=np.uint8)
    colors = ((30, 30, 210), (30, 170, 40), (210, 80, 20), (20, 210, 240))
    for index, color in enumerate(colors):
        row, column = divmod(index, 2)
        image[row * 300 : (row + 1) * 300, column * 300 : (column + 1) * 300] = color
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()


def test_samples_four_regions():
    processed = process_face_image(_face_image())
    assert len(processed.samples) == 4
    assert len({sample.preview_hex for sample in processed.samples}) == 4
    assert not processed.quality.retake_recommended


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
