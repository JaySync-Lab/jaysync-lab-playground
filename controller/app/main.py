"""
FastAPI app for the playground session controller (Phase 3, Steps 3.4-3.5),
plus wiring for the Step 3.6 reaper as a lifespan-managed background task.

UNTESTED-PENDING-HOST: this module wires together proxmox_client, sessions,
ttyd_health, reaper, and ws_proxy into the two endpoints the plan specifies
(POST /sessions, WS /ws/{session_id}). It imports cleanly and starts
without crashing structurally (verified — see the summary), but none of its
request/response paths have been exercised against a real Proxmox host or a
real browser. Every "Verify before continuing" checklist item in
playground-phase3-session-controller-plan.md for Steps 3.4/3.5/3.6 is still
outstanding.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
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


@app.websocket("/ws/{session_id}")
async def websocket_session(websocket: WebSocket, session_id: str, token: str) -> None:
    session = await sessions.get(session_id)
    if session is None or session.token != token:
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
        proxmox.destroy(session.vmid)
        logger.info("Session %s ended, CT %s destroyed", session_id, session.vmid)
