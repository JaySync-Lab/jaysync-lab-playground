"""
Step 3.6 — background reaper: the safety net independent of per-session
timers. Runs on a fixed interval, checks the *actual* current members of
the playground-sandbox pool via the Proxmox API (ground truth, not the
controller's in-memory session table), and destroys anything whose real
uptime exceeds max session duration + grace period — regardless of what the
controller's own bookkeeping thinks is happening. This is what recovers
orphaned clones after a controller crash/restart, per the "verify, don't
just trust the code path ran" principle used throughout this project.

UNTESTED-PENDING-HOST: the loop structure and duration-comparison logic can
be read and reasoned about, but this has never run against a real pool with
real clones. Step 3.6's own verification gate ("kill the controller process
entirely... confirm the orphaned clone still gets destroyed") requires the
live host and hasn't been attempted.
"""

from __future__ import annotations

import asyncio
import logging

from . import config
from .proxmox_client import ProxmoxClient

logger = logging.getLogger("controller.reaper")


async def reaper_loop(proxmox: ProxmoxClient, stop_event: asyncio.Event) -> None:
    max_age_seconds = config.SESSION_MAX_DURATION_MINUTES * 60 + config.SESSION_GRACE_PERIOD_SECONDS

    while not stop_event.is_set():
        try:
            await _reap_once(proxmox, max_age_seconds)
        except Exception:
            # A failed reaper pass must not kill the loop — it's the safety
            # net; it needs to keep trying on the next tick regardless.
            logger.exception("Reaper pass failed — will retry next interval")

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=config.REAPER_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            pass  # normal case: interval elapsed, loop again


async def _reap_once(proxmox: ProxmoxClient, max_age_seconds: float) -> None:
    members = proxmox.list_pool_members()
    for vmid in members:
        uptime = proxmox.uptime_seconds(vmid)
        if uptime is None:
            continue  # not running — not this reaper's concern
        if uptime > max_age_seconds:
            logger.warning(
                "Reaper destroying CT %s — uptime %.0fs exceeds max %.0fs",
                vmid,
                uptime,
                max_age_seconds,
            )
            proxmox.destroy(vmid)
