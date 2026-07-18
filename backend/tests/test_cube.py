from __future__ import annotations

import random

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.cube.coordinates import decode_state, encode_state
from app.cube.facelets import facelets_to_state, state_to_facelets
from app.cube.model import SOLVED_STATE, Color, Face
from app.cube.moves import MOVES, apply_sequence

TARGET = {
    Face.U: Color.WHITE,
    Face.D: Color.YELLOW,
    Face.F: Color.GREEN,
    Face.B: Color.BLUE,
    Face.R: Color.RED,
    Face.L: Color.ORANGE,
}


@pytest.mark.parametrize("move", MOVES)
def test_move_followed_by_inverse(move):
    assert apply_sequence(SOLVED_STATE, [move, move.inverse]) == SOLVED_STATE


@pytest.mark.parametrize("face_move", ["U", "R", "F"])
def test_four_quarter_turns(face_move):
    assert apply_sequence(
        SOLVED_STATE, [next(m for m in MOVES if m.notation == face_move)] * 4
    ).is_solved


@pytest.mark.parametrize("half_turn", ["U2", "R2", "F2"])
def test_two_half_turns(half_turn):
    move = next(m for m in MOVES if m.notation == half_turn)
    assert apply_sequence(SOLVED_STATE, [move, move]).is_solved


@given(st.lists(st.sampled_from(MOVES), min_size=0, max_size=30))
def test_coordinate_round_trip(moves):
    state = apply_sequence(SOLVED_STATE, moves)
    assert decode_state(encode_state(state)) == state


def test_facelet_round_trip_for_scrambles():
    randomizer = random.Random(20260718)
    for _ in range(100):
        state = apply_sequence(SOLVED_STATE, [randomizer.choice(MOVES) for _ in range(20)])
        facelets = state_to_facelets(state, TARGET)
        assert facelets_to_state(facelets).state == state


def test_solved_facelets_normalize():
    facelets = {face: [color] * 4 for face, color in TARGET.items()}
    assert facelets_to_state(facelets).state.is_solved
