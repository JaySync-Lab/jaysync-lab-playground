"""
Waits for a session clone's ttyd port to become reachable after start, per
Step 3.4 point 6: "if it never comes up, destroy the half-started clone and
return 'playground unavailable' rather than handing back a broken session."

Tested against the real Proxmox host — see implementation-log.md Phase 3,
Step 3.8. Every real session created during that testing polled through
this function successfully; TTYD_HEALTHCHECK_TIMEOUT_SECONDS (30s default)
was never hit in practice (real clone+start+ttyd-up completed well under
it), so the polling loop is proven, though the timeout value itself is
still the original placeholder, not re-tuned against measured worst-case
timing.
"""

from __future__ import annotations

import asyncio


async def wait_for_ttyd(host: str, port: int, timeout: float, poll_interval: float) -> bool:
    """Poll a raw TCP connect to (host, port) until it succeeds or timeout
    elapses. Returns True if reachable, False if it never came up."""
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=poll_interval
            )
            writer.close()
            await writer.wait_closed()
            return True
        except (ConnectionRefusedError, OSError, asyncio.TimeoutError):
            await asyncio.sleep(poll_interval)
    return False
