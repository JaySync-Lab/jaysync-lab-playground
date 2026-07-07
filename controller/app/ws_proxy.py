"""
Step 3.5 — WebSocket proxy. Relays raw traffic bidirectionally between the
browser's WebSocket connection and the session clone's ttyd instance
(reachable only via the controller's vmbr_sandbox NIC, per the plan's
network design). This is a dumb byte pipe on purpose: the assumption is
that whatever browser-side client connects to the controller already
speaks ttyd's own wire protocol (as ttyd's stock JS client / xterm.js
integration does), so the controller never needs to parse or reframe the
traffic — only relay it. That assumption turned out to be only half right:
see below.

Tested against the real Proxmox host — see implementation-log.md Phase 3,
Step 3.8, where this file's two real bugs were found and fixed: (1) ttyd's
own client sends its initial handshake as a text frame, not binary, which
the original receive_bytes()-only pump crashed on; and (2) the original
gather()-based relay never returned on a one-sided disconnect (the other
pump had no reason to end just because its peer did), which silently broke
"destroy on disconnect" entirely until real testing caught an orphaned
clone sitting in pct list well after its client had gone away.
"""

from __future__ import annotations

import asyncio
import logging

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from . import config

logger = logging.getLogger("controller.ws_proxy")


async def relay(client_ws: WebSocket, sandbox_ip: str) -> None:
    ttyd_url = f"ws://{sandbox_ip}:{config.TTYD_PORT}/ws"
    async with websockets.connect(ttyd_url, subprotocols=["tty"]) as ttyd_ws:
        pump_a = asyncio.create_task(_pump_client_to_ttyd(client_ws, ttyd_ws))
        pump_b = asyncio.create_task(_pump_ttyd_to_client(ttyd_ws, client_ws))
        # Either side ending (browser disconnect, or ttyd/session-clone going
        # away) must tear down the whole relay -- gather() with both tasks
        # would instead block until BOTH finish, but the other side has no
        # reason to close just because its peer did, leaving the connection
        # (and the "destroy on disconnect" finally block in main.py) hung
        # indefinitely. Whichever finishes first wins; cancel the rest.
        done, pending = await asyncio.wait(
            {pump_a, pump_b}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
        for task in pending:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass


async def _pump_client_to_ttyd(client_ws: WebSocket, ttyd_ws) -> None:
    try:
        while True:
            # ttyd's own client sends its initial handshake (AuthToken +
            # terminal size) as a text frame, and INPUT frames as binary --
            # receive_bytes() alone raises on the handshake and kills this
            # pump before any real traffic flows. Forward each frame as
            # whatever type it arrived as so `websockets`' .send() picks the
            # matching frame type on the ttyd side.
            message = await client_ws.receive()
            if message["type"] == "websocket.disconnect":
                return
            if message.get("bytes") is not None:
                await ttyd_ws.send(message["bytes"])
            elif message.get("text") is not None:
                await ttyd_ws.send(message["text"])
    except (WebSocketDisconnect, websockets.ConnectionClosed):
        return


async def _pump_ttyd_to_client(ttyd_ws, client_ws: WebSocket) -> None:
    try:
        async for message in ttyd_ws:
            payload = message if isinstance(message, (bytes, bytearray)) else message.encode()
            await client_ws.send_bytes(payload)
    except (WebSocketDisconnect, websockets.ConnectionClosed):
        return
