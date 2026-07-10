"""
Central configuration for the playground session controller.

Tested against the real Proxmox host — see implementation-log.md Phase 3,
Step 3.8. SANDBOX_SUBNET_PREFIX/CONTROLLER_SANDBOX_IP are confirmed correct
against the real vmbr_sandbox layout. SESSION_MAX_DURATION_MINUTES and
TTYD_HEALTHCHECK_TIMEOUT_SECONDS are still the original placeholder values
(15 min, 30s) — Step 3.8 only needed to lower them temporarily for a
practical timeout test, not to re-tune the real defaults, so treat those two
as "proven to work," not "proven optimal."
"""

import os


def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    return int(value) if value else default


def _env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    return float(value) if value else default


# --- Proxmox API connection (required at runtime; no defaults on purpose) ---
PROXMOX_HOST = os.environ.get("PROXMOX_HOST", "")
PROXMOX_NODE = os.environ.get("PROXMOX_NODE", "")
PROXMOX_TOKEN_ID = os.environ.get("PROXMOX_TOKEN_ID", "")  # e.g. "playground-ctrl@pve!api-token"
PROXMOX_TOKEN_SECRET = os.environ.get("PROXMOX_TOKEN_SECRET", "")
PROXMOX_VERIFY_SSL = os.environ.get("PROXMOX_VERIFY_SSL", "false").lower() == "true"

# --- Fixed by decisions already made in the plan ---
POOL_NAME = "playground-sandbox"
# 180 is the golden template again. It was briefly rebuilt at 183 to fix
# ttyd's localhost-only binding (see proxmox_client.py's clone_template
# docstring and implementation-log.md), then moved back to 180 once that fix
# was proven, so the VMID convention matches Phase 2 again and 183 could be
# retired. Unlike 183, 180 falls outside VMID_RANGE below, so
# next_free_vmid() no longer needs to explicitly exclude it.
TEMPLATE_VMID = 180
VMID_RANGE = range(181, 200)  # 181-199 inclusive
# env-overridable (not just a plain constant) so the real cap can be
# temporarily lowered for a real through-the-UI capacity test without a
# code redeploy -- e.g. MAX_CONCURRENT_SESSIONS=1 in controller.env makes
# the "at capacity" state reachable from a single test vantage point.
MAX_CONCURRENT_SESSIONS = _env_int("MAX_CONCURRENT_SESSIONS", 3)
MAX_SESSIONS_PER_SOURCE_IP = 1
REAPER_INTERVAL_SECONDS = 30  # Step 3.6: "runs periodically (e.g. every 30 seconds)"

# --- Placeholders pending real-host timing data (see module docstring) ---
SESSION_MAX_DURATION_MINUTES = _env_int("SESSION_MAX_DURATION_MINUTES", 15)
SESSION_GRACE_PERIOD_SECONDS = _env_int("SESSION_GRACE_PERIOD_SECONDS", 60)
TTYD_HEALTHCHECK_TIMEOUT_SECONDS = _env_float("TTYD_HEALTHCHECK_TIMEOUT_SECONDS", 30.0)
TTYD_HEALTHCHECK_POLL_INTERVAL_SECONDS = 1.0

# CT 180 is a proper Proxmox template, so clones are linked clones — Phase 2
# (implementation-log.md) measured these at ~1.5s. This timeout is a safety
# margin for the task-completion poll, not the expected duration; a real
# clone should finish it almost immediately.
CLONE_TASK_TIMEOUT_SECONDS = _env_float("CLONE_TASK_TIMEOUT_SECONDS", 30.0)
CLONE_TASK_POLL_INTERVAL_SECONDS = 0.5

# --- ttyd / sandbox-segment networking ---
# ASSUMPTION (untested against the real host): the plan documents the
# controller as dual-homed (net0 on vmbr0, net1 on vmbr_sandbox) but leaves
# the clone/controller IP scheme on vmbr_sandbox as "no IP needed, or an
# internal-only IP" — an open decision, not a specified one. Since the
# controller must open outbound TCP sockets to reach each clone's ttyd port,
# plain L2 reachability isn't enough on its own; this code assumes static
# IPs are assigned on an internal-only /24 keyed by VMID, with no gateway
# (vmbr_sandbox has no route out, by design — see Phase 1 in
# implementation-log.md). Confirm this scheme still matches what Step 3.2
# actually configures on CT 105's eth1 before relying on it.
TTYD_PORT = 7681
SANDBOX_SUBNET_PREFIX = os.environ.get("SANDBOX_SUBNET_PREFIX", "10.99.0")  # + ".<vmid>"
CONTROLLER_SANDBOX_IP = os.environ.get("CONTROLLER_SANDBOX_IP", "10.99.0.1")


def clone_sandbox_ip(vmid: int) -> str:
    """Static IP convention for a session clone on vmbr_sandbox — see the
    networking ASSUMPTION above. VMIDs are 181-199 so this fits in one
    /24 host octet without collision."""
    return f"{SANDBOX_SUBNET_PREFIX}.{vmid}"
