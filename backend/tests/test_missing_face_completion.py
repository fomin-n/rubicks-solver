from __future__ import annotations

import random

from app.cube.complete_missing_face import (
    complete_missing_face,
    unique_color_permutations,
)
from app.cube.facelets import facelets_to_state, rotate_face, state_to_facelets
from app.cube.model import SOLVED_STATE, SUPPORTED_SOLVED_COLORS, Color, Face
from app.cube.moves import MOVES, apply_sequence
from app.cube.solver import get_solver

RANDOM_STATE_COUNT = 512


def _without_down(facelets: dict[Face, list[Color]]) -> dict[Face, list[Color]]:
    return {face: list(stickers) for face, stickers in facelets.items() if face != Face.D}


def test_solved_cube_reconstructs_down_with_canonical_index_order():
    full = state_to_facelets(SOLVED_STATE, SUPPORTED_SOLVED_COLORS)
    result = complete_missing_face(_without_down(full))
    assert result.status == "unique"
    assert result.candidate_count == 1
    assert result.inferred_face == (
        Color.YELLOW,
        Color.YELLOW,
        Color.YELLOW,
        Color.YELLOW,
    )
    assert result.completed_facelets == full


def test_deterministic_random_states_reconstruct_the_exact_original_down_face():
    randomizer = random.Random(20260722)
    solver = get_solver()
    for index in range(RANDOM_STATE_COUNT):
        state = apply_sequence(
            SOLVED_STATE,
            [randomizer.choice(MOVES) for _ in range(25)],
        )
        full = state_to_facelets(state, SUPPORTED_SOLVED_COLORS)
        result = complete_missing_face(_without_down(full))
        assert result.status == "unique", index
        assert result.inferred_face == tuple(full[Face.D]), index
        assert result.completed_facelets == full, index
        if index < 32:
            assert result.completed_facelets is not None
            inferred_state = facelets_to_state(result.completed_facelets).state
            solution = solver.solve(inferred_state)
            assert apply_sequence(inferred_state, solution).is_solved


def test_whole_cube_rotation_of_supported_scheme_still_completes_exactly():
    rotated_colors = {
        Face.U: Color.WHITE,
        Face.R: Color.GREEN,
        Face.F: Color.ORANGE,
        Face.D: Color.YELLOW,
        Face.L: Color.BLUE,
        Face.B: Color.RED,
    }
    state = apply_sequence(SOLVED_STATE, [MOVES[3], MOVES[1], MOVES[6], MOVES[5]])
    full = state_to_facelets(state, rotated_colors)
    result = complete_missing_face(_without_down(full))
    assert result.status == "unique"
    assert result.completed_facelets == full


def test_repeated_missing_colors_use_only_unique_permutations():
    colors = [Color.YELLOW, Color.YELLOW, Color.WHITE, Color.WHITE]
    permutations = unique_color_permutations(colors)
    assert len(permutations) == 6
    assert len(set(permutations)) == 6


def test_invalid_partial_counts_have_no_completion():
    full = state_to_facelets(SOLVED_STATE, SUPPORTED_SOLVED_COLORS)
    partial = _without_down(full)
    partial[Face.U][0] = Color.RED
    result = complete_missing_face(partial)
    assert result.status == "none"
    assert result.candidate_count == 0


def test_impossible_lower_corner_combination_has_no_completion():
    full = state_to_facelets(SOLVED_STATE, SUPPORTED_SOLVED_COLORS)
    partial = _without_down(full)
    partial[Face.F][3], partial[Face.R][2] = partial[Face.R][2], partial[Face.F][3]
    result = complete_missing_face(partial)
    assert result.status == "none"


def test_rotated_scanned_face_has_no_completion():
    state = apply_sequence(
        SOLVED_STATE,
        [MOVES[3], MOVES[0], MOVES[8], MOVES[4], MOVES[1]],
    )
    full = state_to_facelets(state, SUPPORTED_SOLVED_COLORS)
    partial = _without_down(full)
    partial[Face.F] = rotate_face(partial[Face.F])
    result = complete_missing_face(partial)
    assert result.status == "none"


def test_scrambled_down_face_uses_exact_direct_view_indices():
    state = apply_sequence(
        SOLVED_STATE,
        [MOVES[3], MOVES[0], MOVES[6], MOVES[5], MOVES[2], MOVES[7]],
    )
    full = state_to_facelets(state, SUPPORTED_SOLVED_COLORS)
    assert full[Face.D] != [Color.YELLOW] * 4
    result = complete_missing_face(_without_down(full))
    assert result.inferred_face == tuple(full[Face.D])
    assert result.completed_facelets is not None
    assert result.completed_facelets[Face.D] == full[Face.D]
