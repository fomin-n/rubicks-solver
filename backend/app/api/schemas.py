from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.cube.model import Color, Face
from app.sessions.store import FaceSource


def _camel_case(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.title() for part in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=_camel_case)


class CommitMode(StrEnum):
    ALWAYS = "always"
    IF_ACCEPTABLE = "if_acceptable"
    NEVER = "never"


class ErrorBody(ApiModel):
    code: str
    message: str
    details: Any | None = None


class FaceletsPayload(ApiModel):
    faces: dict[Face, list[Color]]


class SampleResponse(ApiModel):
    lab: tuple[float, float, float]
    preview_hex: str
    consistency: float
    confidence: float | None = None


class QualityResponse(ApiModel):
    blur_score: float
    boundary_score: float
    underexposed_fraction: float
    full_image_underexposed_fraction: float
    sticker_median_brightness: float
    overexposed_fraction: float
    glare_fraction: float
    border_dark_fraction: float
    separator_dark_fraction: float
    sticker_dark_fraction: float
    face_structure_score: float
    warnings: list[str]
    warning_codes: list[str]
    blocking_reasons: list[str]
    retake_recommended: bool


class CapturedFacePreviewResponse(ApiModel):
    face: Face
    preview_hex: list[str]
    predicted_colors: list[Color | None]
    confidence: list[float]
    provisional: bool
    warnings: list[str]
    warning_codes: list[str]
    source: FaceSource


class SessionResponse(ApiModel):
    session_id: UUID
    scan_order: list[Face]
    scanned_faces: list[Face]
    next_face: Face | None
    expires_at: datetime
    facelets: dict[Face, list[Color]] | None = None
    confidence: dict[Face, list[float]] | None = None
    captured_faces: dict[Face, CapturedFacePreviewResponse]
    completion_status: Literal["pending", "unique", "none", "ambiguous"]
    completion_diagnostics: list[str]


class ValidationIssueResponse(ApiModel):
    code: str
    message: str
    face: Face | None = None
    faces: list[Face] = Field(default_factory=list)


class RotationSuggestionResponse(ApiModel):
    face: Face
    quarter_turns: int
    message: str


class ValidationResponse(ApiModel):
    valid: bool
    color_counts: dict[Color, int]
    errors: list[ValidationIssueResponse]
    suggestions: list[RotationSuggestionResponse]


class UploadResponse(ApiModel):
    face: Face
    acceptable: bool
    committed: bool
    readiness_code: str
    readiness_message: str
    samples: list[SampleResponse]
    quality: QualityResponse
    scans_complete: bool
    facelets: dict[Face, list[Color]] | None = None
    confidence: dict[Face, list[float]] | None = None
    preview: CapturedFacePreviewResponse
    captured_faces: dict[Face, CapturedFacePreviewResponse]
    completion_status: Literal["pending", "unique", "none", "ambiguous"]
    completion_diagnostics: list[str]
    validation: ValidationResponse | None = None


class OverlayResponse(ApiModel):
    visible_face: Face
    surface: str
    direction: str


class MoveResponse(ApiModel):
    notation: str
    face: Face
    quarter_turns: int
    clockwise: bool
    description: str
    overlay: OverlayResponse
    resulting_facelets: dict[Face, list[Color]]


class SolveResponse(ApiModel):
    metric: str = "HTM"
    optimal: bool = True
    move_count: int
    initial_facelets: dict[Face, list[Color]]
    target_face_colors: dict[Face, Color]
    moves: list[MoveResponse]


class HealthResponse(ApiModel):
    status: str = "ok"
