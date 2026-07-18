# Test data

All fixtures in this directory are original and programmatically generated. Run:

```bash
uv run --project backend python scripts/generate_test_images.py
```

Backend tests generate equivalent images in memory. `states.json` covers a valid demo scramble,
an invalid color count, and the expected clockwise face-index rotation.

