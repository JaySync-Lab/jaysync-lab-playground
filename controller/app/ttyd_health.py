"""
Waits for a session clone's ttyd port to become reachable after start, per
Step 3.4 point 6: "if it never comes up, destroy the half-started clone and
return 'playground unavailable' rather than handing back a broken session."

UNTESTED-PENDING-HOST: this has never actually polled a real ttyd instance.
TTYD_HEALTHCHECK_TIMEOUT_SECONDS in config.py is an explicit open item in
the plan ("pick a number once you see real clone/start timing") — the
default there is a guess, not a measured value, so even a successful run of
this function today would only prove the polling loop works, not that the
timeout is well-calibrated.
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
