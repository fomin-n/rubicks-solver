# Test data

The `generated/` fixtures are original and programmatically generated. Run:

```bash
uv run --project backend python scripts/generate_test_images.py
```

Backend tests generate equivalent images in memory. `states.json` covers a valid demo scramble,
an invalid color count, and the expected clockwise face-index rotation.

`reference-cube/` contains reduced JPEG copies of the six user-supplied calibration photos for
the one physical black-body 2×2 cube supported by this MVP. They intentionally retain the hand,
light background, black plastic, sticker glare, and white Rubik's logo so vision regressions use
the same distractions as the real scan environment.
