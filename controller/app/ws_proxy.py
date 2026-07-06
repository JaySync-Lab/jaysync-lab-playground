"""
Step 3.5 — WebSocket proxy. Relays raw traffic bidirectionally between the
browser's WebSocket connection and the session clone's ttyd instance
(reachable only via the controller's vmbr_sandbox NIC, per the plan's
network design). This is a dumb byte pipe on purpose: the assumption is
that whatever browser-side client connects to the controller already
speaks ttyd's own wire protocol (as ttyd's stock JS client / xterm.js
integration does), so the controller never needs to parse or reframe the
traffic — only relay it. If that assumption turns out wrong once tested
against a real client, this is the file to revisit.

UNTESTED-PENDING-HOST: connecting to a real ttyd instance and relaying
actual terminal traffic has never been exercised — there is no live clone
to connect to. The relay structure (two concurrent pump tasks, exit when
either side closes) is standard and reasoned through, but Step 3.5's own
verification gate ("a real browser... can connect and get a working
terminal into a freshly cloned CT") is explicitly pending the live host.
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
        await asyncio.gather(
            _pump_client_to_ttyd(client_ws, ttyd_ws),
            _pump_ttyd_to_client(ttyd_ws, client_ws),
            return_exceptions=True,
        )


async def _pump_client_to_ttyd(client_ws: WebSocket, ttyd_ws) -> None:
    try:
        while True:
            message = await client_ws.receive_bytes()
            await ttyd_ws.send(message)
    except (WebSocketDisconnect, websockets.ConnectionClosed):
        return


async def _pump_ttyd_to_client(ttyd_ws, client_ws: WebSocket) -> None:
    try:
        async for message in ttyd_ws:
            payload = message if isinstance(message, (bytes, bytearray)) else message.encode()
            await client_ws.send_bytes(payload)
    except (WebSocketDisconnect, websockets.ConnectionClosed):
        return
