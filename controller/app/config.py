"""
Central configuration for the playground session controller.

UNTESTED-PENDING-HOST: none of the values below have been validated against
the real Proxmox host — it was offline for this entire implementation pass
(see PHASE3_EXECUTION_BRIEF.md). In particular, SANDBOX_SUBNET_PREFIX /
CONTROLLER_SANDBOX_IP, SESSION_MAX_DURATION_MINUTES, and
TTYD_HEALTHCHECK_TIMEOUT_SECONDS are explicit open items in
playground-phase3-session-controller-plan.md ("pick a number once you see
real clone/start timing... don't guess in advance"). The defaults here are
placeholders to let the code run end-to-end once Step 3.1-3.3 are unblocked
— not tuned values. Confirm/adjust once Step 3.4 runs against the real host.
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
# Was 180; that template was destroyed and rebuilt at 183 to fix ttyd's
# localhost-only binding (see proxmox_client.py's clone_template docstring
# and implementation-log.md). 183 falls inside VMID_RANGE below, so
# next_free_vmid() explicitly excludes TEMPLATE_VMID -- don't assume the
# template always lives outside the session range.
TEMPLATE_VMID = 183
VMID_RANGE = range(181, 200)  # 181-199 inclusive
MAX_CONCURRENT_SESSIONS = 3
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
