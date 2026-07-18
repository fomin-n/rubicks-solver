from __future__ import annotations

from dataclasses import dataclass

from .model import CubeState, Face


@dataclass(frozen=True, slots=True)
class Move:
    notation: str
    face: Face
    quarter_turns: int

    @property
    def clockwise(self) -> bool:
        return self.quarter_turns > 0

    @property
    def description(self) -> str:
        direction = (
            "180 degrees"
            if abs(self.quarter_turns) == 2
            else ("clockwise" if self.clockwise else "counterclockwise")
        )
        return f"Turn the {self.face.name.lower()} face {direction}"

    @property
    def inverse(self) -> Move:
        if abs(self.quarter_turns) == 2:
            return self
        return MOVE_BY_NOTATION[
            self.notation[:-1] if self.notation.endswith("'") else f"{self.notation}'"
        ]


MOVES = (
    Move("U", Face.U, 1),
    Move("U'", Face.U, -1),
    Move("U2", Face.U, 2),
    Move("R", Face.R, 1),
    Move("R'", Face.R, -1),
    Move("R2", Face.R, 2),
    Move("F", Face.F, 1),
    Move("F'", Face.F, -1),
    Move("F2", Face.F, 2),
)
MOVE_BY_NOTATION = {move.notation: move for move in MOVES}

# new position -> old position; orientation delta at new position
_BASE_MOVES: dict[Face, tuple[tuple[int, ...], tuple[int, ...]]] = {
    Face.U: ((3, 0, 1, 2, 4, 5, 6, 7), (0, 0, 0, 0, 0, 0, 0, 0)),
    Face.R: ((4, 1, 2, 0, 7, 5, 6, 3), (2, 0, 0, 1, 1, 0, 0, 2)),
    Face.F: ((1, 5, 2, 3, 0, 4, 6, 7), (1, 2, 0, 0, 2, 1, 0, 0)),
}


def apply_quarter_turn(state: CubeState, face: Face) -> CubeState:
    permutation, orientation = _BASE_MOVES[face]
    return CubeState(
        tuple(state.corner_permutation[source] for source in permutation),
        tuple(
            (state.corner_orientation[source] + orientation[position]) % 3
            for position, source in enumerate(permutation)
        ),
    )


def apply_move(state: CubeState, move: Move | str) -> CubeState:
    selected = MOVE_BY_NOTATION[move] if isinstance(move, str) else move
    turns = 2 if abs(selected.quarter_turns) == 2 else (selected.quarter_turns % 4)
    result = state
    for _ in range(turns):
        result = apply_quarter_turn(result, selected.face)
    return result


def apply_sequence(state: CubeState, moves: list[Move] | tuple[Move, ...]) -> CubeState:
    result = state
    for move in moves:
        result = apply_move(result, move)
    return result
