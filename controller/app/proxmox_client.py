"""
Thin wrapper around proxmoxer for everything the controller needs: cloning
CT 180 into the playground-sandbox pool, starting/stopping/destroying
clones, and reading real pool membership + uptime for the reaper.

UNTESTED-PENDING-HOST: every method in this file makes a real Proxmox API
call. None of them have been exercised against the actual host — it was
offline for the entirety of this implementation pass (see
PHASE3_EXECUTION_BRIEF.md, Step 3.1). This module imports cleanly and the
call shapes match the proxmoxer/Proxmox API as documented, but the only
real verification the plan calls for — Step 3.3's "manual test clone via
the API... succeeds using this token, before any controller code depends
on it" — has not happened yet. Treat every method here as unverified until
that step runs.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from proxmoxer import ProxmoxAPI

from . import config

logger = logging.getLogger("controller.proxmox")


@dataclass
class CloneResult:
    vmid: int
    sandbox_ip: str


class ProxmoxClient:
    def __init__(self) -> None:
        if not (
            config.PROXMOX_HOST
            and config.PROXMOX_NODE
            and config.PROXMOX_TOKEN_ID
            and config.PROXMOX_TOKEN_SECRET
        ):
            raise RuntimeError(
                "Proxmox connection is not configured — PROXMOX_HOST, PROXMOX_NODE, "
                "PROXMOX_TOKEN_ID, and PROXMOX_TOKEN_SECRET must all be set "
                "(see controller/.env.example). Step 3.3 (creating the API token) "
                "is paused until the host is back online, so this will legitimately "
                "fail to construct until then."
            )
        token_user, token_name = config.PROXMOX_TOKEN_ID.split("!", 1)
        self._proxmox = ProxmoxAPI(
            config.PROXMOX_HOST,
            user=token_user,
            token_name=token_name,
            token_value=config.PROXMOX_TOKEN_SECRET,
            verify_ssl=config.PROXMOX_VERIFY_SSL,
        )
        self._node = self._proxmox.nodes(config.PROXMOX_NODE)

    def list_pool_members(self) -> list[int]:
        """Ground truth for the reaper — actual current members of the
        playground-sandbox pool, not the controller's in-memory session
        table. Restricted to the configured VMID range as a defensive
        filter in case the pool ever contains something unexpected (the
        template CT 180 or the controller CT 105 itself should never be
        pool members, but this guards against it regardless)."""
        pool = self._proxmox.pools(config.POOL_NAME).get()
        members = pool.get("members", [])
        return [
            int(m["vmid"])
            for m in members
            if m.get("type") == "lxc" and int(m["vmid"]) in config.VMID_RANGE
        ]

    def next_free_vmid(self, in_use: set[int]) -> int | None:
        for vmid in config.VMID_RANGE:
            if vmid not in in_use:
                return vmid
        return None

    def clone_template(self, vmid: int, hostname: str) -> CloneResult:
        logger.info("Cloning CT %s -> new CT %s (%s)", config.TEMPLATE_VMID, vmid, hostname)
        # No `full` param: CT 180 is a proper Proxmox template (Phase 2), so
        # the clone API defaults to a linked clone — fast (~1.5s, measured in
        # implementation-log.md) and disk-efficient. Passing full=1 would
        # force a full disk clone every session, contradicting the whole
        # point of converting CT 180 into a template in the first place.
        upid = self._node.lxc(config.TEMPLATE_VMID).clone.post(
            newid=vmid,
            hostname=hostname,
            pool=config.POOL_NAME,
        )
        # clone.post() returns a task UPID immediately — the clone itself is
        # asynchronous. Modifying the new CT's config before the task
        # actually finishes would race against Proxmox still creating it.
        self._wait_for_task(upid)

        sandbox_ip = config.clone_sandbox_ip(vmid)
        # Static IP on the sandbox-only NIC — see the networking ASSUMPTION
        # in config.py. No gateway: vmbr_sandbox has no route out, by design.
        self._node.lxc(vmid).config.put(
            net0=f"name=eth0,bridge=vmbr_sandbox,ip={sandbox_ip}/24,firewall=1"
        )
        return CloneResult(vmid=vmid, sandbox_ip=sandbox_ip)

    def _wait_for_task(
        self,
        upid: str,
        timeout: float | None = None,
        poll_interval: float | None = None,
    ) -> None:
        """Poll a Proxmox task until it completes. Several Proxmox API calls
        (clone included) return a task UPID immediately rather than blocking
        until the operation finishes — callers must not assume completion
        just because .post()/.put() returned. Reads config values at call
        time (not as default-argument snapshots) so env-based overrides
        always take effect."""
        timeout = config.CLONE_TASK_TIMEOUT_SECONDS if timeout is None else timeout
        poll_interval = (
            config.CLONE_TASK_POLL_INTERVAL_SECONDS if poll_interval is None else poll_interval
        )
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            status = self._node.tasks(upid).status.get()
            if status.get("status") == "stopped":
                exitstatus = status.get("exitstatus", "")
                # Proxmox reports "OK" on a clean run and "WARNINGS: N" when
                # the task completed but logged non-fatal warnings (e.g. the
                # systemd/nesting advisory every clone of CT 180 emits, since
                # it was deliberately built with nesting=0 in Phase 2) — both
                # are successful completions. Only anything else (a real
                # error string, or a missing exitstatus) is a genuine failure.
                if exitstatus != "OK" and not exitstatus.startswith("WARNINGS"):
                    raise RuntimeError(f"Proxmox task {upid} failed: {exitstatus}")
                return
            time.sleep(poll_interval)
        raise TimeoutError(f"Proxmox task {upid} did not complete within {timeout}s")

    def start(self, vmid: int) -> None:
        logger.info("Starting CT %s", vmid)
        self._node.lxc(vmid).status.start.post()

    def stop(self, vmid: int) -> None:
        logger.info("Stopping CT %s", vmid)
        self._node.lxc(vmid).status.stop.post()

    def destroy(self, vmid: int) -> None:
        """Stop (if running) then destroy. Stopping is best-effort — destroy
        is the part that must not silently fail, since a leftover clone
        consumes a VMID and disk space indefinitely."""
        try:
            self.stop(vmid)
        except Exception:
            logger.warning(
                "Stop failed for CT %s (may already be stopped) — continuing to destroy",
                vmid,
                exc_info=True,
            )
        logger.info("Destroying CT %s", vmid)
        # force=1: last-resort safety net in case stop() above failed and the
        # CT is still running — delete() would otherwise raise instead of
        # guaranteeing cleanup, which is the one thing this method must not fail at.
        self._node.lxc(vmid).delete(force=1)

    def uptime_seconds(self, vmid: int) -> float | None:
        """Real uptime from Proxmox itself — the reaper's ground truth for
        session duration, independent of the controller's own in-memory
        bookkeeping. Returns None if the CT isn't currently running."""
        status = self._node.lxc(vmid).status.current.get()
        if status.get("status") != "running":
            return None
        return float(status.get("uptime", 0))
