from __future__ import annotations

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.cube.facelets import state_to_facelets
from app.cube.model import SOLVED_STATE, Color, Face
from app.cube.moves import MOVE_BY_NOTATION, apply_sequence
from app.main import app

client = TestClient(app)
TARGET = {
    Face.U: Color.WHITE,
    Face.D: Color.YELLOW,
    Face.F: Color.GREEN,
    Face.B: Color.BLUE,
    Face.R: Color.RED,
    Face.L: Color.ORANGE,
}


def _session_id() -> str:
    response = client.post("/api/sessions")
    assert response.status_code == 201
    return response.json()["sessionId"]


def _png() -> bytes:
    image = np.full((400, 400, 3), (40, 100, 200), dtype=np.uint8)
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()


def _face_png(colors: list[Color], exposure: float = 1.0) -> bytes:
    bgr = {
        Color.RED: (45, 45, 215),
        Color.BLUE: (205, 95, 30),
        Color.ORANGE: (35, 130, 245),
        Color.WHITE: (230, 235, 240),
        Color.GREEN: (70, 165, 35),
        Color.YELLOW: (35, 220, 240),
    }
    image = np.full((600, 600, 3), 18, dtype=np.uint8)
    for index, color in enumerate(colors):
        row, column = divmod(index, 2)
        adjusted = np.clip(np.asarray(bgr[color]) * exposure, 0, 255).astype(np.uint8)
        image[
            row * 300 + 10 : (row + 1) * 300 - 10, column * 300 + 10 : (column + 1) * 300 - 10
        ] = adjusted
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()


def test_health_session_upload_and_delete():
    assert client.get("/api/health").json() == {"status": "ok"}
    session_id = _session_id()
    upload = client.post(
        f"/api/sessions/{session_id}/faces/F",
        files={"image": ("face.png", _png(), "image/png")},
    )
    assert upload.status_code == 200
    upload_body = upload.json()
    assert len(upload_body["samples"]) == 4
    assert len(upload_body["preview"]["previewHex"]) == 4
    assert upload_body["preview"]["provisional"] is True
    state = client.get(f"/api/sessions/{session_id}").json()
    assert state["scannedFaces"] == ["F"]
    assert len(state["capturedFaces"]["F"]["previewHex"]) == 4
    assert client.delete(f"/api/sessions/{session_id}").status_code == 204
    missing = client.get(f"/api/sessions/{session_id}")
    assert missing.status_code == 404
    assert missing.json()["code"] == "session_not_found"


def test_manual_state_validation_and_optimal_solve():
    session_id = _session_id()
    scramble = apply_sequence(
        SOLVED_STATE,
        [MOVE_BY_NOTATION[name] for name in ("R", "U", "F'", "R2", "U2")],
    )
    facelets = state_to_facelets(scramble, TARGET)
    payload = {
        "faces": {
            face.value: [color.value for color in colors] for face, colors in facelets.items()
        }
    }
    update = client.put(f"/api/sessions/{session_id}/facelets", json=payload)
    assert update.status_code == 200
    assert update.json()["valid"] is True
    assert client.post(f"/api/sessions/{session_id}/validate").json()["valid"] is True
    solved = client.post(f"/api/sessions/{session_id}/solve")
    assert solved.status_code == 200
    body = solved.json()
    assert body["optimal"] is True
    assert body["metric"] == "HTM"
    assert body["moveCount"] == len(body["moves"])
    assert body["moveCount"] > 0


def test_six_images_are_balanced_classified_and_validated():
    session_id = _session_id()
    scramble = apply_sequence(
        SOLVED_STATE,
        [MOVE_BY_NOTATION[name] for name in ("R", "U", "F'", "R2", "U2")],
    )
    expected = state_to_facelets(scramble, TARGET)
    final = None
    for face in (Face.F, Face.R, Face.B, Face.L, Face.U, Face.D):
        response = client.post(
            f"/api/sessions/{session_id}/faces/{face.value}",
            files={"image": (f"{face.value}.png", _face_png(expected[face]), "image/png")},
        )
        assert response.status_code == 200
        final = response.json()
    assert final is not None
    assert final["scansComplete"] is True
    assert all(not preview["provisional"] for preview in final["capturedFaces"].values())
    recognized = final["facelets"]
    assert sorted(color for stickers in recognized.values() for color in stickers) == sorted(
        color.value for color in Color for _ in range(4)
    )
    assert client.post(f"/api/sessions/{session_id}/validate").json()["valid"] is True


def test_invalid_state_and_unknown_session():
    session_id = _session_id()
    faces = {face.value: [color.value] * 4 for face, color in TARGET.items()}
    faces["U"][0] = "red"
    update = client.put(f"/api/sessions/{session_id}/facelets", json={"faces": faces})
    assert update.json()["valid"] is False
    solve = client.post(f"/api/sessions/{session_id}/solve")
    assert solve.status_code == 409
    assert solve.json()["code"] == "invalid_cube"
    assert client.get("/api/sessions/00000000-0000-0000-0000-000000000000").status_code == 404


def test_upload_rejects_wrong_type_and_oversize():
    session_id = _session_id()
    wrong = client.post(
        f"/api/sessions/{session_id}/faces/F",
        files={"image": ("face.txt", b"hello", "text/plain")},
    )
    assert wrong.status_code == 415
    large = client.post(
        f"/api/sessions/{session_id}/faces/F",
        files={"image": ("face.png", b"0" * (5 * 1024 * 1024 + 1), "image/png")},
    )
    assert large.status_code == 413


def test_candidate_commit_modes_are_non_destructive():
    session_id = _session_id()
    rejected = client.post(
        f"/api/sessions/{session_id}/faces/F?commitMode=if_acceptable",
        files={"image": ("blurred.png", _png(), "image/png")},
    )
    assert rejected.status_code == 200
    assert rejected.json()["acceptable"] is False
    assert rejected.json()["committed"] is False
    assert rejected.json()["readinessCode"] == "blurry"
    assert client.get(f"/api/sessions/{session_id}").json()["scannedFaces"] == []

    diagnostic = client.post(
        f"/api/sessions/{session_id}/faces/F?commitMode=never",
        files={"image": ("face.png", _face_png([Color.RED] * 4), "image/png")},
    )
    assert diagnostic.status_code == 200
    assert diagnostic.json()["committed"] is False
    assert client.get(f"/api/sessions/{session_id}").json()["scannedFaces"] == []

    forced = client.post(
        f"/api/sessions/{session_id}/faces/F?commitMode=always",
        files={"image": ("blurred.png", _png(), "image/png")},
    )
    assert forced.status_code == 200
    assert forced.json()["committed"] is True
    assert client.get(f"/api/sessions/{session_id}").json()["scannedFaces"] == ["F"]


def test_low_light_warning_commits_but_near_black_does_not():
    colors = [Color.RED, Color.BLUE, Color.GREEN, Color.YELLOW]
    low_light_session = _session_id()
    low_light = client.post(
        f"/api/sessions/{low_light_session}/faces/F?commitMode=if_acceptable",
        files={"image": ("low-light.png", _face_png(colors, 0.35), "image/png")},
    )
    assert low_light.status_code == 200
    low_light_body = low_light.json()
    assert low_light_body["acceptable"] is True
    assert low_light_body["committed"] is True
    assert low_light_body["readinessCode"] == "ready_with_warnings"
    assert low_light_body["quality"]["retakeRecommended"] is False
    assert low_light_body["quality"]["blockingReasons"] == []
    assert low_light_body["quality"]["stickerMedianBrightness"] < 55
    assert client.get(f"/api/sessions/{low_light_session}").json()["scannedFaces"] == ["F"]

    dark_session = _session_id()
    near_black_bytes = _face_png(colors, 0.05)
    near_black = client.post(
        f"/api/sessions/{dark_session}/faces/F?commitMode=if_acceptable",
        files={"image": ("near-black.png", near_black_bytes, "image/png")},
    )
    assert near_black.status_code == 200
    assert near_black.json()["acceptable"] is False
    assert near_black.json()["committed"] is False
    assert near_black.json()["readinessCode"] == "too_dark"
    assert client.get(f"/api/sessions/{dark_session}").json()["scannedFaces"] == []

    forced = client.post(
        f"/api/sessions/{dark_session}/faces/F?commitMode=always",
        files={"image": ("near-black.png", near_black_bytes, "image/png")},
    )
    assert forced.json()["committed"] is True
    assert client.get(f"/api/sessions/{dark_session}").json()["scannedFaces"] == ["F"]


def test_replacing_one_face_preserves_other_previews():
    session_id = _session_id()
    first = client.post(
        f"/api/sessions/{session_id}/faces/F?commitMode=always",
        files={
            "image": (
                "F.png",
                _face_png([Color.RED, Color.BLUE, Color.GREEN, Color.YELLOW]),
                "image/png",
            )
        },
    ).json()
    second = client.post(
        f"/api/sessions/{session_id}/faces/R?commitMode=always",
        files={
            "image": (
                "R.png",
                _face_png([Color.ORANGE, Color.WHITE, Color.BLUE, Color.GREEN]),
                "image/png",
            )
        },
    ).json()
    right_before = second["capturedFaces"]["R"]
    replacement = client.post(
        f"/api/sessions/{session_id}/faces/F?commitMode=always",
        files={
            "image": (
                "F-new.png",
                _face_png([Color.YELLOW, Color.GREEN, Color.BLUE, Color.RED]),
                "image/png",
            )
        },
    ).json()
    assert replacement["capturedFaces"]["R"] == right_before
    assert (
        replacement["capturedFaces"]["F"]["previewHex"] != first["capturedFaces"]["F"]["previewHex"]
    )
    assert set(client.get(f"/api/sessions/{session_id}").json()["scannedFaces"]) == {"F", "R"}
