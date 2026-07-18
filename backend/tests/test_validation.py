from __future__ import annotations

from app.cube.facelets import rotate_face, state_to_facelets
from app.cube.model import SOLVED_STATE, Color, Face
from app.cube.moves import MOVE_BY_NOTATION, apply_sequence
from app.cube.validation import validate_facelets

TARGET = {
    Face.U: Color.WHITE,
    Face.D: Color.YELLOW,
    Face.F: Color.GREEN,
    Face.B: Color.BLUE,
    Face.R: Color.RED,
    Face.L: Color.ORANGE,
}


def test_wrong_color_count_is_actionable():
    facelets = {face: [color] * 4 for face, color in TARGET.items()}
    facelets[Face.U][0] = Color.RED
    result = validate_facelets(facelets)
    assert not result.valid
    assert any("White appears 3 times" in error.message for error in result.errors)
    assert any("Red appears 5 times" in error.message for error in result.errors)


def test_valid_scramble_and_rotated_scan_suggestion():
    state = apply_sequence(
        SOLVED_STATE,
        [MOVE_BY_NOTATION[name] for name in ("R", "U'", "F2", "R2", "U")],
    )
    facelets = state_to_facelets(state, TARGET)
    assert validate_facelets(facelets).valid

    facelets[Face.R] = rotate_face(facelets[Face.R])
    invalid = validate_facelets(facelets)
    assert not invalid.valid
    assert any(
        suggestion.face == Face.R and suggestion.quarter_turns == 3
        for suggestion in invalid.suggestions
    )
