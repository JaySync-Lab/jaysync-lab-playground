"""
FastAPI app for the playground session controller (Phase 3, Steps 3.4-3.5),
plus wiring for the Step 3.6 reaper as a lifespan-managed background task.

Tested against the real Proxmox host — see implementation-log.md Phase 3,
Step 3.8, for the full end-to-end scenarios and the bugs found along the way
(most relevantly here: the DELETE endpoint and the tolerant destroy() error
handling in both it and the WebSocket handler's finally block were both
added during that step).
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import config
from .proxmox_client import ProxmoxClient
from .reaper import reaper_loop
from .sessions import SessionTable
from .ttyd_health import wait_for_ttyd
from .ws_proxy import relay

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("controller.main")

sessions = SessionTable()


@asynccontextmanager
async def lifespan(app: FastAPI):
    proxmox = ProxmoxClient()
    app.state.proxmox = proxmox

    stop_event = asyncio.Event()
    reaper_task = asyncio.create_task(reaper_loop(proxmox, stop_event))
    logger.info("Reaper task started (interval=%ss)", config.REAPER_INTERVAL_SECONDS)

    yield

    stop_event.set()
    await reaper_task


app = FastAPI(title="Playground Session Controller", lifespan=lifespan)

# Step 4.1: the controller is now reachable publicly via the Cloudflare
# Tunnel (api.jslnode.anujajay.com), so the frontend on its own separate
# origin (jslnode.anujajay.com) needs explicit CORS allowance -- plus
# localhost:3000 for local frontend dev against the real backend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://jslnode.anujajay.com", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    # Step 4.4: the frontend polls this to detect whether the backend is
    # reachable at all -- deliberately cheap (no Proxmox calls, no schema
    # generation like /openapi.json), just confirms the process is up and
    # serving requests through the tunnel.
    #
    # active_sessions/max_sessions (round 2 of frontend fixes): reuses this
    # same poll for the "X of N sessions active" indicator rather than
    # adding a second endpoint/poll loop -- count_active() is just an
    # in-memory dict length, no Proxmox call, so this stays cheap.
    return {
        "status": "ok",
        "active_sessions": await sessions.count_active(),
        "max_sessions": config.MAX_CONCURRENT_SESSIONS,
    }


@app.get("/status")
async def status(request: Request) -> dict:
    # Part 4: real host CPU/RAM, backing the frontend's live hardware
    # stats display. Unlike /health, this is a real Proxmox API call each
    # time -- not cached, not deliberately cheap -- since the whole point
    # is showing genuinely current load, not a stale snapshot. Requires
    # Sys.Audit on /nodes/{node}, confirmed against Proxmox's own API
    # schema before this endpoint was written (see implementation-log.md).
    proxmox: ProxmoxClient = request.app.state.proxmox
    return proxmox.node_status()


class SessionResponse(BaseModel):
    session_id: str
    token: str
    connect_info: dict


@app.post("/sessions", response_model=SessionResponse)
async def create_session(request: Request) -> SessionResponse:
    proxmox: ProxmoxClient = request.app.state.proxmox
    source_ip = request.client.host if request.client else "unknown"

    if await sessions.count_active() >= config.MAX_CONCURRENT_SESSIONS:
        raise HTTPException(
            status_code=503, detail="playground unavailable — at capacity, try again shortly"
        )

    if await sessions.has_active_for_ip(source_ip):
        raise HTTPException(
            status_code=429, detail="playground unavailable — you already have an active session"
        )

    in_use = {s.vmid for s in await sessions.all_active()}
    vmid = proxmox.next_free_vmid(in_use)
    if vmid is None:
        raise HTTPException(status_code=503, detail="playground unavailable — no free session slot")

    clone = proxmox.clone_template(vmid, hostname=f"playground-session-{vmid}")
    proxmox.start(vmid)

    reachable = await wait_for_ttyd(
        clone.sandbox_ip,
        config.TTYD_PORT,
        timeout=config.TTYD_HEALTHCHECK_TIMEOUT_SECONDS,
        poll_interval=config.TTYD_HEALTHCHECK_POLL_INTERVAL_SECONDS,
    )
    if not reachable:
        logger.error(
            "CT %s never became reachable on ttyd port %s — destroying", vmid, config.TTYD_PORT
        )
        proxmox.destroy(vmid)
        raise HTTPException(status_code=503, detail="playground unavailable — session failed to start")

    session = await sessions.create(
        vmid=vmid,
        source_ip=source_ip,
        sandbox_ip=clone.sandbox_ip,
        duration_seconds=config.SESSION_MAX_DURATION_MINUTES * 60,
    )

    return SessionResponse(
        session_id=session.session_id,
        token=session.token,
        connect_info={"ws_path": f"/ws/{session.session_id}"},
    )


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str, token: str, request: Request) -> dict:
    proxmox: ProxmoxClient = request.app.state.proxmox
    session = await sessions.get(session_id)
    if session is None or not secrets.compare_digest(session.token, token):
        raise HTTPException(status_code=404, detail="session not found")

    await sessions.remove(session_id)
    try:
        proxmox.destroy(session.vmid)
    except Exception:
        # Session may already be gone (WS disconnect handler or the reaper
        # got there first) -- the table entry is removed either way, and a
        # destroy on an already-destroyed VMID must not surface as a 500
        # for what is, from the caller's perspective, a successful teardown.
        logger.warning("Destroy for CT %s failed (already gone?)", session.vmid, exc_info=True)
    return {"status": "destroyed"}


@app.websocket("/ws/{session_id}")
async def websocket_session(websocket: WebSocket, session_id: str, token: str) -> None:
    session = await sessions.get(session_id)
    if session is None or not secrets.compare_digest(session.token, token):
        await websocket.close(code=4401)
        return
    if time.time() > session.expires_at:
        await sessions.remove(session_id)
        await websocket.close(code=4408)
        return

    await websocket.accept()
    proxmox: ProxmoxClient = websocket.app.state.proxmox
    try:
        await relay(websocket, session.sandbox_ip)
    except WebSocketDisconnect:
        pass
    finally:
        # "Disposable over resettable" — destroy immediately on disconnect,
        # don't wait for the timeout/reaper.
        await sessions.remove(session_id)
        try:
            proxmox.destroy(session.vmid)
        except Exception:
            # The reaper or a manual DELETE /sessions call may have already
            # destroyed this CT (e.g. it timed out mid-connection) -- a
            # redundant destroy attempt must not blow up the finally block.
            logger.warning("Destroy for CT %s failed (already gone?)", session.vmid, exc_info=True)
        logger.info("Session %s ended, CT %s destroyed", session_id, session.vmid)
