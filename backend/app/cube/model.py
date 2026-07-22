from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Face(StrEnum):
    U = "U"
    R = "R"
    F = "F"
    D = "D"
    L = "L"
    B = "B"


class Color(StrEnum):
    RED = "red"
    BLUE = "blue"
    ORANGE = "orange"
    WHITE = "white"
    GREEN = "green"
    YELLOW = "yellow"


OPPOSITE_COLOR: dict[Color, Color] = {
    Color.WHITE: Color.YELLOW,
    Color.YELLOW: Color.WHITE,
    Color.RED: Color.ORANGE,
    Color.ORANGE: Color.RED,
    Color.GREEN: Color.BLUE,
    Color.BLUE: Color.GREEN,
}

SUPPORTED_SOLVED_COLORS: dict[Face, Color] = {
    Face.U: Color.WHITE,
    Face.R: Color.RED,
    Face.F: Color.GREEN,
    Face.D: Color.YELLOW,
    Face.L: Color.ORANGE,
    Face.B: Color.BLUE,
}

FACE_ORDER = (Face.U, Face.R, Face.F, Face.D, Face.L, Face.B)
SCAN_ORDER = (Face.F, Face.R, Face.B, Face.L, Face.U)
CORNER_NAMES = ("URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB")

type FaceletKey = tuple[Face, int]
type FaceletMap = dict[Face, list[Color]]
type CanonicalFaceletMap = dict[Face, list[Face]]

# Sticker order within each tuple determines corner orientation.
CORNER_FACELETS: tuple[tuple[FaceletKey, FaceletKey, FaceletKey], ...] = (
    ((Face.U, 3), (Face.R, 0), (Face.F, 1)),  # URF
    ((Face.U, 2), (Face.F, 0), (Face.L, 1)),  # UFL
    ((Face.U, 0), (Face.L, 0), (Face.B, 1)),  # ULB
    ((Face.U, 1), (Face.B, 0), (Face.R, 1)),  # UBR
    ((Face.D, 1), (Face.F, 3), (Face.R, 2)),  # DFR
    ((Face.D, 0), (Face.L, 3), (Face.F, 2)),  # DLF
    ((Face.D, 2), (Face.B, 3), (Face.L, 2)),  # DBL
    ((Face.D, 3), (Face.R, 3), (Face.B, 2)),  # DRB
)

CORNER_COLORS: tuple[tuple[Face, Face, Face], ...] = (
    (Face.U, Face.R, Face.F),
    (Face.U, Face.F, Face.L),
    (Face.U, Face.L, Face.B),
    (Face.U, Face.B, Face.R),
    (Face.D, Face.F, Face.R),
    (Face.D, Face.L, Face.F),
    (Face.D, Face.B, Face.L),
    (Face.D, Face.R, Face.B),
)


@dataclass(frozen=True, slots=True)
class CubeState:
    corner_permutation: tuple[int, ...] = tuple(range(8))
    corner_orientation: tuple[int, ...] = (0,) * 8

    def __post_init__(self) -> None:
        if len(self.corner_permutation) != 8 or len(self.corner_orientation) != 8:
            raise ValueError("A cube state must contain eight corners")
        if sorted(self.corner_permutation) != list(range(8)):
            raise ValueError("Corner permutation must contain every corner exactly once")
        if any(value not in (0, 1, 2) for value in self.corner_orientation):
            raise ValueError("Corner orientations must be 0, 1, or 2")
        if sum(self.corner_orientation) % 3:
            raise ValueError("Corner orientation sum must be divisible by three")

    @property
    def is_solved(self) -> bool:
        return self == SOLVED_STATE


SOLVED_STATE = CubeState()
