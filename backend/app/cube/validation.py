from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from .facelets import FaceletConversionError, facelets_to_state, rotate_face
from .model import CORNER_FACELETS, FACE_ORDER, Color, Face, FaceletMap


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    code: str
    message: str
    face: Face | None = None


@dataclass(frozen=True, slots=True)
class RotationSuggestion:
    face: Face
    quarter_turns: int
    message: str


@dataclass(slots=True)
class ValidationResult:
    valid: bool
    errors: list[ValidationIssue] = field(default_factory=list)
    suggestions: list[RotationSuggestion] = field(default_factory=list)


def _structural_errors(facelets: FaceletMap) -> list[ValidationIssue]:
    errors: list[ValidationIssue] = []
    missing = [face.value for face in FACE_ORDER if face not in facelets]
    if missing:
        errors.append(ValidationIssue("missing_faces", f"Missing faces: {', '.join(missing)}."))
        return errors
    for face in FACE_ORDER:
        if len(facelets[face]) != 4:
            errors.append(
                ValidationIssue(
                    "wrong_facelet_count",
                    f"Face {face.value} has {len(facelets[face])} facelets; expected 4.",
                    face,
                )
            )
    if errors:
        return errors

    counts = Counter(color for face in FACE_ORDER for color in facelets[face])
    for color in Color:
        count = counts[color]
        if count != 4:
            errors.append(
                ValidationIssue(
                    "wrong_color_count",
                    f"{color.value.capitalize()} appears {count} times; expected 4.",
                )
            )
    return errors


def _corner_errors(facelets: FaceletMap) -> list[ValidationIssue]:
    errors: list[ValidationIssue] = []
    seen: Counter[frozenset[Color]] = Counter()
    opposite_pairs = (
        frozenset((Color.WHITE, Color.YELLOW)),
        frozenset((Color.RED, Color.ORANGE)),
        frozenset((Color.GREEN, Color.BLUE)),
    )
    for position, keys in enumerate(CORNER_FACELETS):
        colors = [facelets[face][index] for face, index in keys]
        color_set = frozenset(colors)
        seen[color_set] += 1
        if len(color_set) != 3:
            errors.append(
                ValidationIssue("repeated_corner_color", f"Corner {position + 1} repeats a color.")
            )
        for pair in opposite_pairs:
            if pair <= color_set:
                first, second = sorted(color.value for color in pair)
                errors.append(
                    ValidationIssue(
                        "opposite_corner_colors",
                        f"Corner {position + 1} contains both {first} and {second}; "
                        "they are opposite colors.",
                    )
                )
    duplicates = [colors for colors, count in seen.items() if count > 1]
    if duplicates:
        errors.append(
            ValidationIssue(
                "duplicate_corners", "At least one physical corner appears more than once."
            )
        )
    return errors


def _validate_without_suggestions(facelets: FaceletMap) -> ValidationResult:
    errors = _structural_errors(facelets)
    if errors:
        return ValidationResult(False, errors)
    errors.extend(_corner_errors(facelets))
    if errors:
        return ValidationResult(False, errors)
    try:
        facelets_to_state(facelets)
    except FaceletConversionError as error:
        errors.append(ValidationIssue("impossible_orientation", str(error)))
    return ValidationResult(not errors, errors)


def validate_facelets(facelets: FaceletMap, *, suggest_rotations: bool = True) -> ValidationResult:
    result = _validate_without_suggestions(facelets)
    if (
        result.valid
        or not suggest_rotations
        or any(
            issue.code in {"missing_faces", "wrong_facelet_count", "wrong_color_count"}
            for issue in result.errors
        )
    ):
        return result

    for face in FACE_ORDER:
        for turns in (1, 2, 3):
            candidate = {key: list(values) for key, values in facelets.items()}
            candidate[face] = rotate_face(candidate[face], turns)
            if _validate_without_suggestions(candidate).valid:
                degrees = turns * 90
                result.suggestions.append(
                    RotationSuggestion(
                        face,
                        turns,
                        f"Rotate face {face.value} clockwise by {degrees}° and validate again.",
                    )
                )
    return result
