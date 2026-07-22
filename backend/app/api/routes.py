from __future__ import annotations

from collections import Counter
from dataclasses import asdict
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Query, UploadFile

from app.cube.complete_missing_face import complete_missing_face
from app.cube.facelets import facelets_to_state, state_to_facelets
from app.cube.model import SCAN_ORDER, Color, Face, FaceletMap
from app.cube.moves import apply_move
from app.cube.solver import get_solver
from app.cube.validation import validate_facelets
from app.sessions.store import FaceSource, Session, store
from app.vision.colors import CANONICAL_HEX, classify_partial_samples, classify_provisional
from app.vision.processing import (
    MAX_UPLOAD_BYTES,
    ImageProcessingError,
    ProcessedFace,
    QualityReport,
    process_face_image,
)

from .schemas import (
    CapturedFacePreviewResponse,
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
        captured_faces=_captured_previews(session),
        completion_status=session.completion_status or "pending",
        completion_diagnostics=list(session.completion_diagnostics),
    )


def _face_preview(
    face: Face,
    processed: ProcessedFace,
    final_colors: list[Color] | None = None,
    final_confidence: list[float] | None = None,
) -> CapturedFacePreviewResponse:
    samples = processed.samples
    predicted, confidence = classify_provisional(samples)
    display_colors = final_colors or predicted
    return CapturedFacePreviewResponse(
        face=face,
        preview_hex=[CANONICAL_HEX[color] for color in display_colors],
        predicted_colors=display_colors,
        confidence=final_confidence or confidence,
        provisional=final_colors is None,
        warnings=list(processed.quality.warnings),
        warning_codes=list(processed.quality.warning_codes),
        source=FaceSource.SCANNED,
    )


def _captured_previews(session: Session) -> dict[Face, CapturedFacePreviewResponse]:
    previews = {
        face: _face_preview(
            face,
            session.scans[face],
            session.facelets[face] if session.facelets else None,
            session.confidence[face] if session.confidence else None,
        )
        for face in SCAN_ORDER
        if face in session.scans
    }
    if (
        session.facelets
        and session.confidence
        and session.face_sources.get(Face.D) == FaceSource.INFERRED
    ):
        colors = session.facelets[Face.D]
        previews[Face.D] = CapturedFacePreviewResponse(
            face=Face.D,
            preview_hex=[CANONICAL_HEX[color] for color in colors],
            predicted_colors=colors,
            confidence=session.confidence[Face.D],
            provisional=False,
            warnings=[],
            warning_codes=[],
            source=FaceSource.INFERRED,
        )
    return previews


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
    if face not in SCAN_ORDER:
        raise ApiError(409, "face_is_inferred", "Face D is calculated from the other five faces.")
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
    completion_validation: ValidationResponse | None = None
    if committed:
        session.scans[face] = processed
        session.facelets = None
        session.confidence = None
        session.face_sources = {
            scanned_face: FaceSource.SCANNED
            for scanned_face in SCAN_ORDER
            if scanned_face in session.scans
        }
        session.completion_status = None
        session.completion_diagnostics = ()
        if all(scan_face in session.scans for scan_face in SCAN_ORDER):
            partial_facelets, partial_confidence = classify_partial_samples(
                {scan_face: session.scans[scan_face].samples for scan_face in SCAN_ORDER}
            )
            completion = complete_missing_face(partial_facelets)
            session.completion_status = completion.status
            session.completion_diagnostics = completion.diagnostics
            if completion.status == "unique":
                assert completion.completed_facelets is not None
                session.facelets = completion.completed_facelets
                session.confidence = {
                    **partial_confidence,
                    Face.D: [1.0] * 4,
                }
                session.face_sources[Face.D] = FaceSource.INFERRED
                completion_validation = _validation_response(session.facelets)
            else:
                completion_validation = _completion_failure_response(
                    partial_facelets,
                    completion.status,
                )
    readiness_code, readiness_message = _capture_readiness(processed.quality, acceptable)
    previews = _captured_previews(session)
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
        preview=previews.get(face, _face_preview(face, processed)),
        captured_faces=previews,
        completion_status=session.completion_status or "pending",
        completion_diagnostics=list(session.completion_diagnostics),
        validation=completion_validation,
    )


def _capture_readiness(quality: QualityReport, acceptable: bool) -> tuple[str, str]:
    if "not_cube" in quality.blocking_reasons:
        return "not_cube", "Center one complete 2x2 face, including its black border and cross."
    if "too_dark" in quality.blocking_reasons:
        return "too_dark", "The sticker regions are nearly black; add some light and try again."
    if "glare" in quality.blocking_reasons:
        return "glare", "Reduce reflections or move away from the light."
    if "blurry" in quality.blocking_reasons:
        return "blurry", "Hold the cube and camera steady."
    if not acceptable:
        return "inconsistent", "Center one face inside the guide and try again."
    if quality.warning_codes:
        if "low_light" in quality.warning_codes:
            return "ready_with_warnings", "Low light detected, but sticker colors are usable."
        return "ready_with_warnings", "The image is usable with minor quality warnings."
    return "ready", "Face quality is suitable."


@router.put("/sessions/{session_id}/facelets", response_model=ValidationResponse)
def update_facelets(session_id: UUID, payload: FaceletsPayload) -> ValidationResponse:
    session = _session_or_404(session_id)
    session.facelets = {face: list(stickers) for face, stickers in payload.faces.items()}
    session.confidence = {face: [1.0] * 4 for face in session.facelets}
    session.face_sources = {}
    session.completion_status = None
    session.completion_diagnostics = ()
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


def _completion_failure_response(
    partial_facelets: FaceletMap,
    status: str,
) -> ValidationResponse:
    counts = Counter(color for stickers in partial_facelets.values() for color in stickers)
    message = (
        "The final face has more than one valid completion. Retake a highlighted face."
        if status == "ambiguous"
        else (
            "The final face could not be calculated from the current scans. "
            "Retake a highlighted face."
        )
    )
    return ValidationResponse(
        valid=False,
        color_counts={color: counts[color] for color in Color},
        errors=[
            ValidationIssueResponse(
                code="missing_face_completion_failed",
                message=message,
                faces=list(SCAN_ORDER),
            )
        ],
        suggestions=[],
    )


@router.post("/sessions/{session_id}/validate", response_model=ValidationResponse)
def validate_session(session_id: UUID) -> ValidationResponse:
    session = _session_or_404(session_id)
    if session.facelets is None:
        raise ApiError(
            409,
            "incomplete_scan",
            "Scan the five requested faces or enter the cube manually.",
        )
    return _validation_response(session.facelets)


@router.post("/sessions/{session_id}/solve", response_model=SolveResponse)
def solve_session(session_id: UUID) -> SolveResponse:
    session = _session_or_404(session_id)
    if session.facelets is None:
        raise ApiError(
            409,
            "incomplete_scan",
            "Scan the five requested faces or enter the cube manually.",
        )
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
