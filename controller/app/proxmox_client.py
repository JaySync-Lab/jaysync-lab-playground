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
        self._node.lxc(config.TEMPLATE_VMID).clone.post(
            newid=vmid,
            hostname=hostname,
            pool=config.POOL_NAME,
            full=1,
        )
        sandbox_ip = config.clone_sandbox_ip(vmid)
        # Static IP on the sandbox-only NIC — see the networking ASSUMPTION
        # in config.py. No gateway: vmbr_sandbox has no route out, by design.
        self._node.lxc(vmid).config.put(
            net0=f"name=eth0,bridge=vmbr_sandbox,ip={sandbox_ip}/24,firewall=1"
        )
        return CloneResult(vmid=vmid, sandbox_ip=sandbox_ip)

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
        self._node.lxc(vmid).delete()

    def uptime_seconds(self, vmid: int) -> float | None:
        """Real uptime from Proxmox itself — the reaper's ground truth for
        session duration, independent of the controller's own in-memory
        bookkeeping. Returns None if the CT isn't currently running."""
        status = self._node.lxc(vmid).status.current.get()
        if status.get("status") != "running":
            return None
        return float(status.get("uptime", 0))
