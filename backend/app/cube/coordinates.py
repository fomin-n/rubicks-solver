from __future__ import annotations

from math import factorial

from .model import CubeState

MOBILE_POSITIONS = (0, 1, 2, 3, 4, 5, 7)
PERMUTATION_COUNT = factorial(7)
ORIENTATION_COUNT = 3**6
STATE_COUNT = PERMUTATION_COUNT * ORIENTATION_COUNT


def encode_permutation(state: CubeState) -> int:
    values = [MOBILE_POSITIONS.index(state.corner_permutation[pos]) for pos in MOBILE_POSITIONS]
    rank = 0
    available = list(range(7))
    for index, value in enumerate(values):
        selected = available.index(value)
        rank += selected * factorial(6 - index)
        available.pop(selected)
    return rank


def decode_permutation(rank: int) -> CubeState:
    if not 0 <= rank < PERMUTATION_COUNT:
        raise ValueError("Permutation coordinate is out of range")
    available = list(range(7))
    values: list[int] = []
    remaining = rank
    for index in range(7):
        factor = factorial(6 - index)
        selected, remaining = divmod(remaining, factor)
        values.append(available.pop(selected))
    permutation = list(range(8))
    for position, value in zip(MOBILE_POSITIONS, values, strict=True):
        permutation[position] = MOBILE_POSITIONS[value]
    return CubeState(tuple(permutation), (0,) * 8)


def encode_orientation(state: CubeState) -> int:
    coordinate = 0
    for position in MOBILE_POSITIONS[:6]:
        coordinate = coordinate * 3 + state.corner_orientation[position]
    return coordinate


def decode_orientation(coordinate: int) -> CubeState:
    if not 0 <= coordinate < ORIENTATION_COUNT:
        raise ValueError("Orientation coordinate is out of range")
    orientation = [0] * 8
    remaining = coordinate
    for position in reversed(MOBILE_POSITIONS[:6]):
        remaining, orientation[position] = divmod(remaining, 3)
    orientation[MOBILE_POSITIONS[6]] = (-sum(orientation)) % 3
    return CubeState(tuple(range(8)), tuple(orientation))


def encode_state(state: CubeState) -> int:
    if state.corner_permutation[6] != 6 or state.corner_orientation[6] != 0:
        raise ValueError("Reduced coordinates require the DBL corner to be fixed")
    return encode_permutation(state) * ORIENTATION_COUNT + encode_orientation(state)


def decode_state(index: int) -> CubeState:
    if not 0 <= index < STATE_COUNT:
        raise ValueError("State coordinate is out of range")
    permutation_coordinate, orientation_coordinate = divmod(index, ORIENTATION_COUNT)
    permutation = decode_permutation(permutation_coordinate).corner_permutation
    orientation = decode_orientation(orientation_coordinate).corner_orientation
    return CubeState(permutation, orientation)
