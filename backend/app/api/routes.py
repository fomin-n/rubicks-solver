from __future__ import annotations

from collections import Counter
from dataclasses import asdict
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Query, UploadFile

from app.cube.facelets import facelets_to_state, state_to_facelets
from app.cube.model import FACE_ORDER, SCAN_ORDER, Color, Face
from app.cube.moves import apply_move
from app.cube.solver import get_solver
from app.cube.validation import validate_facelets
from app.sessions.store import Session, store
from app.vision.colors import classify_samples
from app.vision.processing import (
    MAX_UPLOAD_BYTES,
    ImageProcessingError,
    QualityReport,
    process_face_image,
)

from .schemas import (
    CommitMode,
    FaceletsPayload,
    HealthResponse,
    MoveResponse,
    OverlayResponse,
    QualityResponse,
    RotationSuggestionResponse,
    SampleResponse,
    SessionResponse,
    SolveResponse,
    UploadResponse,
    ValidationIssueResponse,
    ValidationResponse,
)


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: object = None) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


router = APIRouter(prefix="/api")


def _session_or_404(session_id: UUID) -> Session:
    session = store.get(session_id)
    if session is None:
        raise ApiError(404, "session_not_found", "The scan session was not found or has expired.")
    return session


def _session_response(session: Session) -> SessionResponse:
    scanned = [face for face in SCAN_ORDER if face in session.scans]
    next_face = next((face for face in SCAN_ORDER if face not in session.scans), None)
    return SessionResponse(
        session_id=session.id,
        scan_order=list(SCAN_ORDER),
        scanned_faces=scanned,
        next_face=next_face,
        expires_at=session.expires_at,
        facelets=session.facelets,
        confidence=session.confidence,
    )


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@router.post("/sessions", response_model=SessionResponse, status_code=201)
def create_session() -> SessionResponse:
    return _session_response(store.create())


@router.get("/sessions/{session_id}", response_model=SessionResponse)
def read_session(session_id: UUID) -> SessionResponse:
    return _session_response(_session_or_404(session_id))


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: UUID) -> None:
    if not store.delete(session_id):
        raise ApiError(404, "session_not_found", "The scan session was not found or has expired.")


@router.post("/sessions/{session_id}/faces/{face}", response_model=UploadResponse)
async def upload_face(
    session_id: UUID,
    face: Face,
    image: Annotated[UploadFile, File()],
    commit_mode: Annotated[CommitMode, Query(alias="commitMode")] = CommitMode.ALWAYS,
) -> UploadResponse:
    session = _session_or_404(session_id)
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise ApiError(415, "unsupported_image", "Upload a JPEG, PNG, or WebP image.")
    data = await image.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ApiError(413, "image_too_large", "Images must be 5 MB or smaller.")
    try:
        processed = process_face_image(data)
    except ImageProcessingError as error:
        raise ApiError(422, "invalid_image", str(error)) from error
    acceptable = not processed.quality.retake_recommended
    committed = commit_mode == CommitMode.ALWAYS or (
        commit_mode == CommitMode.IF_ACCEPTABLE and acceptable
    )
    if committed:
        session.scans[face] = processed
        session.facelets = None
        session.confidence = None
        if all(scan_face in session.scans for scan_face in SCAN_ORDER):
            session.facelets, session.confidence = classify_samples(
                {scan_face: session.scans[scan_face].samples for scan_face in FACE_ORDER}
            )
    readiness_code, readiness_message = _capture_readiness(processed.quality, acceptable)
    return UploadResponse(
        face=face,
        acceptable=acceptable,
        committed=committed,
        readiness_code=readiness_code,
        readiness_message=readiness_message,
        samples=[SampleResponse(**asdict(sample)) for sample in processed.samples],
        quality=QualityResponse(**asdict(processed.quality)),
        scans_complete=session.facelets is not None,
        facelets=session.facelets,
        confidence=session.confidence,
    )


def _capture_readiness(quality: QualityReport, acceptable: bool) -> tuple[str, str]:
    if quality.underexposed_fraction > 0.25:
        return "too_dark", "Add diffuse light and try again."
    if quality.overexposed_fraction > 0.25 or quality.glare_fraction > 0.15:
        return "glare", "Reduce reflections or move away from the light."
    if quality.blur_score < 25:
        return "blurry", "Hold the cube and camera steady."
    if not acceptable:
        return "inconsistent", "Center one face inside the guide and try again."
    return "ready", "Face quality is suitable."


@router.put("/sessions/{session_id}/facelets", response_model=ValidationResponse)
def update_facelets(session_id: UUID, payload: FaceletsPayload) -> ValidationResponse:
    session = _session_or_404(session_id)
    session.facelets = {face: list(stickers) for face, stickers in payload.faces.items()}
    session.confidence = {face: [1.0] * 4 for face in session.facelets}
    return _validation_response(session.facelets)


def _validation_response(facelets: dict[Face, list[Color]]) -> ValidationResponse:
    result = validate_facelets(facelets)
    counts = Counter(color for stickers in facelets.values() for color in stickers)
    return ValidationResponse(
        valid=result.valid,
        color_counts={color: counts[color] for color in Color},
        errors=[ValidationIssueResponse(**asdict(issue)) for issue in result.errors],
        suggestions=[
            RotationSuggestionResponse(**asdict(suggestion)) for suggestion in result.suggestions
        ],
    )


@router.post("/sessions/{session_id}/validate", response_model=ValidationResponse)
def validate_session(session_id: UUID) -> ValidationResponse:
    session = _session_or_404(session_id)
    if session.facelets is None:
        raise ApiError(409, "incomplete_scan", "Scan all six faces or enter the cube manually.")
    return _validation_response(session.facelets)


@router.post("/sessions/{session_id}/solve", response_model=SolveResponse)
def solve_session(session_id: UUID) -> SolveResponse:
    session = _session_or_404(session_id)
    if session.facelets is None:
        raise ApiError(409, "incomplete_scan", "Scan all six faces or enter the cube manually.")
    validation = validate_facelets(session.facelets)
    if not validation.valid:
        raise ApiError(
            409,
            "invalid_cube",
            "The cube state is not physically possible yet.",
            [asdict(issue) for issue in validation.errors],
        )
    normalized = facelets_to_state(session.facelets)
    moves = get_solver().solve(normalized.state)
    current = normalized.state
    responses: list[MoveResponse] = []
    for move in moves:
        current = apply_move(current, move)
        responses.append(
            MoveResponse(
                notation=move.notation,
                face=move.face,
                quarter_turns=move.quarter_turns,
                clockwise=move.clockwise,
                description=move.description,
                overlay=OverlayResponse(
                    visible_face=move.face,
                    surface=move.face.value.lower(),
                    direction=(
                        "half"
                        if abs(move.quarter_turns) == 2
                        else ("clockwise" if move.clockwise else "counterclockwise")
                    ),
                ),
                resulting_facelets=state_to_facelets(current, normalized.target_colors),
            )
        )
    if not current.is_solved:
        raise ApiError(500, "solver_failure", "The solver could not verify its result.")
    return SolveResponse(
        move_count=len(moves),
        initial_facelets=session.facelets,
        target_face_colors=normalized.target_colors,
        moves=responses,
    )
