"""
In-memory session table: the controller's own bookkeeping for active
sessions (capacity cap, per-IP limit, token issuance/validation). This is
deliberately NOT the source of truth for "is a clone actually still
running" — the reaper (reaper.py) checks the real Proxmox pool for that,
per Step 3.6, precisely because this table is lost on a crash or restart.

UNTESTED-PENDING-HOST: this module has no external I/O (pure in-memory
Python), so it can genuinely be exercised with a unit test today if
desired — but it has not been, and it has never run inside a live FastAPI
process handling real concurrent requests. Treat the concurrency/locking
behavior as reasoned-through, not proven.
"""

from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass


@dataclass
class Session:
    session_id: str
    vmid: int
    token: str
    source_ip: str
    sandbox_ip: str
    started_at: float
    expires_at: float


class SessionTable:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._lock = asyncio.Lock()

    async def count_active(self) -> int:
        async with self._lock:
            return len(self._sessions)

    async def has_active_for_ip(self, source_ip: str) -> bool:
        async with self._lock:
            return any(s.source_ip == source_ip for s in self._sessions.values())

    async def create(
        self, vmid: int, source_ip: str, sandbox_ip: str, duration_seconds: int
    ) -> Session:
        now = time.time()
        session = Session(
            session_id=secrets.token_urlsafe(16),
            vmid=vmid,
            token=secrets.token_urlsafe(32),
            source_ip=source_ip,
            sandbox_ip=sandbox_ip,
            started_at=now,
            expires_at=now + duration_seconds,
        )
        async with self._lock:
            self._sessions[session.session_id] = session
        return session

    async def get(self, session_id: str) -> Session | None:
        async with self._lock:
            return self._sessions.get(session_id)

    async def remove(self, session_id: str) -> Session | None:
        async with self._lock:
            return self._sessions.pop(session_id, None)

    async def all_active(self) -> list[Session]:
        async with self._lock:
            return list(self._sessions.values())
