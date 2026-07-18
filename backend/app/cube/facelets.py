from __future__ import annotations

from dataclasses import dataclass

from .model import (
    CORNER_COLORS,
    CORNER_FACELETS,
    FACE_ORDER,
    OPPOSITE_COLOR,
    CanonicalFaceletMap,
    Color,
    CubeState,
    Face,
    FaceletMap,
)


@dataclass(frozen=True, slots=True)
class NormalizedCube:
    state: CubeState
    canonical_facelets: CanonicalFaceletMap
    target_colors: dict[Face, Color]


class FaceletConversionError(ValueError):
    pass


def normalize_colors(facelets: FaceletMap) -> tuple[CanonicalFaceletMap, dict[Face, Color]]:
    d_color = facelets[Face.D][2]
    b_color = facelets[Face.B][3]
    l_color = facelets[Face.L][2]
    reference = (d_color, b_color, l_color)
    if len(set(reference)) != 3:
        raise FaceletConversionError("The DBL reference corner repeats a color.")
    if any(OPPOSITE_COLOR[color] in reference for color in reference):
        raise FaceletConversionError("The DBL reference corner contains opposite colors.")

    color_to_face = {
        d_color: Face.D,
        OPPOSITE_COLOR[d_color]: Face.U,
        b_color: Face.B,
        OPPOSITE_COLOR[b_color]: Face.F,
        l_color: Face.L,
        OPPOSITE_COLOR[l_color]: Face.R,
    }
    if len(color_to_face) != 6:
        raise FaceletConversionError(
            "The reference corner must use one color from each opposite pair."
        )
    canonical = {face: [color_to_face[color] for color in facelets[face]] for face in FACE_ORDER}
    target = {canonical_face: color for color, canonical_face in color_to_face.items()}
    return canonical, target


def canonical_facelets_to_state(facelets: CanonicalFaceletMap) -> CubeState:
    permutation: list[int] = []
    orientation: list[int] = []
    for position, keys in enumerate(CORNER_FACELETS):
        stickers = [facelets[face][index] for face, index in keys]
        try:
            twist = next(i for i, sticker in enumerate(stickers) if sticker in (Face.U, Face.D))
        except StopIteration as error:
            raise FaceletConversionError(
                f"Corner {position} has no white/yellow-axis sticker."
            ) from error
        side_one = stickers[(twist + 1) % 3]
        side_two = stickers[(twist + 2) % 3]
        cubie = next(
            (
                index
                for index, colors in enumerate(CORNER_COLORS)
                if colors[1] == side_one and colors[2] == side_two
            ),
            None,
        )
        if cubie is None:
            names = ", ".join(sticker.value for sticker in stickers)
            raise FaceletConversionError(f"Corner {position} has an impossible ordering: {names}.")
        permutation.append(cubie)
        orientation.append(twist % 3)
    try:
        return CubeState(tuple(permutation), tuple(orientation))
    except ValueError as error:
        raise FaceletConversionError(str(error)) from error


def facelets_to_state(facelets: FaceletMap) -> NormalizedCube:
    canonical, target = normalize_colors(facelets)
    state = canonical_facelets_to_state(canonical)
    if state.corner_permutation[6] != 6 or state.corner_orientation[6] != 0:
        raise FaceletConversionError("The DBL normalization invariant was not satisfied.")
    return NormalizedCube(state, canonical, target)


def state_to_canonical_facelets(state: CubeState) -> CanonicalFaceletMap:
    result = {face: [face] * 4 for face in FACE_ORDER}
    for position, keys in enumerate(CORNER_FACELETS):
        cubie = state.corner_permutation[position]
        twist = state.corner_orientation[position]
        for sticker_index in range(3):
            target_key = keys[(sticker_index + twist) % 3]
            face, index = target_key
            result[face][index] = CORNER_COLORS[cubie][sticker_index]
    return result


def state_to_facelets(state: CubeState, target_colors: dict[Face, Color]) -> FaceletMap:
    canonical = state_to_canonical_facelets(state)
    return {
        face: [target_colors[canonical_face] for canonical_face in stickers]
        for face, stickers in canonical.items()
    }


def solved_facelets(target_colors: dict[Face, Color]) -> FaceletMap:
    return {face: [target_colors[face]] * 4 for face in FACE_ORDER}


def rotate_face(stickers: list[Color], turns: int = 1) -> list[Color]:
    result = list(stickers)
    for _ in range(turns % 4):
        result = [result[2], result[0], result[3], result[1]]
    return result
