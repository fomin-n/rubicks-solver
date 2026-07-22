from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from itertools import permutations, product
from typing import Literal

from .facelets import facelets_to_state
from .model import FACE_ORDER, SUPPORTED_SOLVED_COLORS, Color, Face, FaceletMap
from .validation import validate_facelets

type CompletionStatus = Literal["unique", "none", "ambiguous"]

_FACE_VECTORS = {
    Face.R: (1, 0, 0),
    Face.L: (-1, 0, 0),
    Face.U: (0, 1, 0),
    Face.D: (0, -1, 0),
    Face.F: (0, 0, 1),
    Face.B: (0, 0, -1),
}
_VECTOR_FACES = {vector: face for face, vector in _FACE_VECTORS.items()}


@dataclass(frozen=True, slots=True)
class CompletionResult:
    status: CompletionStatus
    completed_facelets: FaceletMap | None
    inferred_face: tuple[Color, Color, Color, Color] | None
    candidate_count: int
    diagnostics: tuple[str, ...]


def unique_color_permutations(colors: list[Color]) -> tuple[tuple[Color, ...], ...]:
    return tuple(
        sorted(set(permutations(colors)), key=lambda values: tuple(value.value for value in values))
    )


def _permutation_sign(axes: tuple[int, int, int]) -> int:
    inversions = sum(axes[left] > axes[right] for left in range(3) for right in range(left + 1, 3))
    return -1 if inversions % 2 else 1


def _supported_target_mappings() -> frozenset[tuple[Color, ...]]:
    mappings: set[tuple[Color, ...]] = set()
    for axes in permutations(range(3)):
        for signs in product((-1, 1), repeat=3):
            if _permutation_sign(axes) * signs[0] * signs[1] * signs[2] != 1:
                continue
            target: dict[Face, Color] = {}
            for original_face, vector in _FACE_VECTORS.items():
                rotated = tuple(signs[row] * vector[axes[row]] for row in range(3))
                target[_VECTOR_FACES[rotated]] = SUPPORTED_SOLVED_COLORS[original_face]
            mappings.add(tuple(target[face] for face in FACE_ORDER))
    return frozenset(mappings)


_SUPPORTED_TARGET_MAPPINGS = _supported_target_mappings()


def _uses_supported_color_scheme(facelets: FaceletMap) -> bool:
    normalized = facelets_to_state(facelets)
    mapping = tuple(normalized.target_colors[face] for face in FACE_ORDER)
    return mapping in _SUPPORTED_TARGET_MAPPINGS


def complete_missing_face(
    partial_faces: dict[Face, list[Color]],
    missing_face: Face = Face.D,
) -> CompletionResult:
    required_faces = tuple(face for face in FACE_ORDER if face != missing_face)
    missing_inputs = [face.value for face in required_faces if face not in partial_faces]
    includes_missing_face = missing_face in partial_faces
    if missing_inputs or includes_missing_face:
        details = []
        if missing_inputs:
            details.append(f"Missing scanned faces: {', '.join(missing_inputs)}.")
        if includes_missing_face:
            details.append(f"Face {missing_face.value} must be omitted before completion.")
        return CompletionResult("none", None, None, 0, tuple(details))

    wrong_lengths = [face.value for face in required_faces if len(partial_faces[face]) != 4]
    if wrong_lengths:
        return CompletionResult(
            "none",
            None,
            None,
            0,
            (f"Faces with the wrong sticker count: {', '.join(wrong_lengths)}.",),
        )

    observed_counts = Counter(color for face in required_faces for color in partial_faces[face])
    if any(observed_counts[color] > 4 for color in Color):
        return CompletionResult(
            "none",
            None,
            None,
            0,
            ("A scanned color appears more than four times.",),
        )

    missing_colors = [color for color in Color for _ in range(4 - observed_counts[color])]
    if len(missing_colors) != 4:
        return CompletionResult(
            "none",
            None,
            None,
            0,
            ("The five scanned faces do not leave exactly four missing stickers.",),
        )

    valid_candidates: list[FaceletMap] = []
    for inferred in unique_color_permutations(missing_colors):
        candidate = {face: list(partial_faces[face]) for face in required_faces}
        candidate[missing_face] = list(inferred)
        if validate_facelets(
            candidate, suggest_rotations=False
        ).valid and _uses_supported_color_scheme(candidate):
            valid_candidates.append(candidate)

    if len(valid_candidates) == 1:
        completed = valid_candidates[0]
        inferred_face = tuple(completed[missing_face])
        return CompletionResult(
            "unique",
            completed,
            inferred_face,
            1,
            (f"Face {missing_face.value} has one physically valid completion.",),
        )

    if not valid_candidates:
        return CompletionResult(
            "none",
            None,
            None,
            0,
            ("The scanned faces do not form a physically valid cube.",),
        )

    return CompletionResult(
        "ambiguous",
        None,
        None,
        len(valid_candidates),
        (f"Face {missing_face.value} has multiple physically valid completions.",),
    )
