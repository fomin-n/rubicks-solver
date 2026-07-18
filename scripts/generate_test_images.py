from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).parents[1]
OUTPUT = ROOT / "test-data" / "generated"
COLORS = {
    "red": (45, 45, 215),
    "blue": (205, 95, 30),
    "orange": (35, 130, 245),
    "white": (230, 235, 240),
    "green": (70, 165, 35),
    "yellow": (35, 220, 240),
}


def face(name: str, stickers: tuple[str, str, str, str], brightness: float = 1.0) -> np.ndarray:
    image = np.full((640, 640, 3), 18, dtype=np.uint8)
    for index, color in enumerate(stickers):
        row, column = divmod(index, 2)
        y0, x0 = row * 320 + 25, column * 320 + 25
        value = np.clip(np.array(COLORS[color]) * brightness, 0, 255).astype(np.uint8)
        image[y0 : y0 + 270, x0 : x0 + 270] = value
    cv2.circle(image, (190, 170), 24, (255, 255, 255), -1)
    cv2.putText(image, name, (20, 625), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (180, 180, 180), 2)
    return image


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    fixtures = {
        "solved-white.png": face("solved", ("white",) * 4),
        "scrambled.png": face("scrambled", ("red", "green", "white", "blue")),
        "dim.png": face("dim", ("orange", "green", "yellow", "blue"), 0.45),
        "bright-glare.png": face("glare", ("yellow", "red", "white", "green"), 1.25),
    }
    for filename, image in fixtures.items():
        if not cv2.imwrite(str(OUTPUT / filename), image):
            raise RuntimeError(f"Could not write {filename}")
    print(f"Generated {len(fixtures)} original fixtures in {OUTPUT}")


if __name__ == "__main__":
    main()

