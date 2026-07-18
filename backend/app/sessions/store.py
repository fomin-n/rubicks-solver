from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from threading import RLock
from uuid import UUID, uuid4

from app.cube.model import Face, FaceletMap
from app.vision.processing import ProcessedFace

SESSION_TTL = timedelta(minutes=30)


@dataclass(slots=True)
class Session:
    id: UUID
    created_at: datetime
    expires_at: datetime
    scans: dict[Face, ProcessedFace] = field(default_factory=dict)
    facelets: FaceletMap | None = None
    confidence: dict[Face, list[float]] | None = None

    def touch(self) -> None:
        self.expires_at = datetime.now(UTC) + SESSION_TTL


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[UUID, Session] = {}
        self._lock = RLock()

    def _cleanup(self) -> None:
        now = datetime.now(UTC)
        expired = [
            session_id
            for session_id, session in self._sessions.items()
            if session.expires_at <= now
        ]
        for session_id in expired:
            del self._sessions[session_id]

    def create(self) -> Session:
        with self._lock:
            self._cleanup()
            now = datetime.now(UTC)
            session = Session(uuid4(), now, now + SESSION_TTL)
            self._sessions[session.id] = session
            return session

    def get(self, session_id: UUID) -> Session | None:
        with self._lock:
            self._cleanup()
            session = self._sessions.get(session_id)
            if session:
                session.touch()
            return session

    def delete(self, session_id: UUID) -> bool:
        with self._lock:
            return self._sessions.pop(session_id, None) is not None


store = SessionStore()
