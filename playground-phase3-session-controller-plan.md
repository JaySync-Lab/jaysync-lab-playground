# Playground Phase 3 — Session Controller
## Implementation Plan

Living plan. Each step has a verification gate — confirm it before moving to
the next, same discipline as Phases 1 and 2 (see `implementation-log.md`).

---

## Decisions already made

- [x] Controller runs on repurposed CT 105 (currently LXC "docs engine",
      unused — being decommissioned first)
- [x] Concurrency: 3 sessions / 10–15 min, matching the original v1.2 design
- [x] Language: Python
- [x] Proxmox access via scoped API token + resource pool, not raw shell
      access to `pct`/`qm`

---

## One architectural point not yet discussed — network placement of the controller itself

`vmbr_sandbox` has zero routing to anywhere, by design (proven in Phase 1).
That means the controller — which needs to reach each session clone's ttyd
instance to proxy the browser's terminal connection — **cannot do so from
`vmbr0` alone.** The controller itself needs a second NIC attached to
`vmbr_sandbox`, making it the one deliberate, narrow bridge between the two
networks. This is intentional and matches the original design ("the
website's only relationship to the playground is: ask controller to start a
session, controller hands back a connection target") — the controller is
the single chokepoint, not a general bridge between the networks.

So CT 105 ends up dual-homed:
- `net0` → `vmbr0` (LAN, `192.168.1.105`) — reachable by the site/API caller
- `net1` → `vmbr_sandbox` (no IP needed, or an internal-only IP) — the only
  path in to reach session clones' ttyd ports

This needs to be set up before any controller code can be tested against a
real session clone.

---

## Step 3.1 — Decommission LXC 105 safely

1. `pct status 105` — confirm current state before touching anything.
2. Open a shell into it and look for anything that only exists there and
   was never committed to `JaySync-Lab` — given the project's manual-
   authorship philosophy, worth being sure nothing unique is about to be
   destroyed.
3. `pct stop 105`
4. `pct destroy 105`
5. Confirm `pct list` no longer shows it, and VMID 105 is free for reuse.

**Verify before continuing:**
- [ ] `pct list` confirms 105 is gone
- [ ] Nothing of value was lost (checked, not assumed)

*(Documentation follow-up — repurposing `production-documentation-engine.mdx`
and updating `inventory.yaml` — is Step 3.9, done once the controller is
actually live and there's something real to describe instead.)*

---

## Step 3.2 — Create CT 105 as the controller host

1. Create a new unprivileged CT with VMID 105, hostname
   `playground-controller`, dual-homed per the network note above:
   ```
   pct create 105 local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst \
     --hostname playground-controller \
     --net0 name=eth0,bridge=vmbr0,ip=192.168.1.105/24,gw=192.168.1.1 \
     --net1 name=eth1,bridge=vmbr_sandbox \
     --unprivileged 1 \
     --memory 512 \
     --rootfs local-lvm:4
   ```
2. Install Python 3.11+, `pip`, and a virtual environment.

**Verify before continuing:**
- [ ] CT 105 boots, reachable on `192.168.1.105` via `vmbr0`
- [ ] `eth1` present and up on `vmbr_sandbox` (no route out — expected,
      confirms it's the same isolated segment)

---

## Step 3.3 — Proxmox resource pool, role, and API token

1. Create the pool:
   ```
   pveum pool add playground-sandbox --comment "Playground session clones"
   ```
2. Create a purpose-built user (not `root@pam`):
   ```
   pveum user add playground-ctrl@pve --comment "Playground session controller"
   ```
3. Create the role with exactly these privileges — no more:
   ```
   pveum role add PlaygroundCtrlRole -privs \
     "VM.Clone,VM.Allocate,VM.Config.CPU,VM.Config.Memory,VM.Config.Network,VM.Config.Options,VM.PowerMgmt,VM.Audit,Pool.Audit,Datastore.AllocateSpace"
   ```
4. Grant the role in **both** required places — this is the part people
   commonly miss (confirmed via real Proxmox forum reports of this exact
   confusion):
   ```
   # On the golden template itself, so the token can clone FROM it
   pveum aclmod /vms/180 -user playground-ctrl@pve -role PlaygroundCtrlRole

   # On the pool, so the token can create INTO it and manage what's there
   pveum aclmod /pool/playground-sandbox -user playground-ctrl@pve -role PlaygroundCtrlRole
   ```
5. Create the API token with privilege separation enabled:
   ```
   pveum user token add playground-ctrl@pve api-token --privsep 1
   ```
   Copy the secret immediately — shown once.
6. Apply the same two ACL grants to the **token** specifically (tokens with
   privilege separation don't inherit the user's ACLs automatically):
   ```
   pveum aclmod /vms/180 -token 'playground-ctrl@pve!api-token' -role PlaygroundCtrlRole
   pveum aclmod /pool/playground-sandbox -token 'playground-ctrl@pve!api-token' -role PlaygroundCtrlRole
   ```

**Verify before continuing:**
- [ ] `pveum user token permissions playground-ctrl@pve!api-token` shows
      both ACL grants
- [ ] A manual test clone via the API (`curl` or a one-off Python snippet)
      succeeds using this token, before any controller code depends on it
- [ ] If it fails with an `SDN.Use` permission error specifically, that's a
      known gap tied to Proxmox's SDN-zone networking — flag it, don't
      assume something else is broken, and add `SDN.Use` to the role at
      that point (not preemptively, since `vmbr_sandbox` is a plain bridge
      and likely doesn't need it)

---

## Step 3.4 — Controller core service (session start)

Framework: FastAPI + `proxmoxer` (Python Proxmox API client) + `uvicorn`.

Core endpoint: `POST /sessions`

Logic, in order:
1. Check current active session count against the cap (3). If at cap,
   return a clear "playground unavailable" response — never a hang.
2. Check per-IP limit (1 active session per source IP). Reject with a clear
   message if violated.
3. Pick the next free VMID in 181–199 (free = not currently an active
   session per the controller's own tracking).
4. Clone CT 180 → new VMID, into the `playground-sandbox` pool, via the API
   token from Step 3.3.
5. Start the clone.
6. Poll the clone's ttyd port (via the controller's `vmbr_sandbox` NIC)
   until reachable, with a sane timeout — if it never comes up, destroy the
   half-started clone and return "playground unavailable" rather than
   handing back a broken session.
7. Generate a short-lived session token, record `{vmid, token, source_ip,
   started_at, expires_at}` in the controller's session table.
8. Return `{session_id, token, connect_info}` to the caller.

**Verify before continuing:**
- [ ] A manual `POST /sessions` call actually clones, starts, and confirms
      ttyd reachability on a real clone
- [ ] Hitting the concurrency cap returns the correct rejection, not a
      crash or a hang
- [ ] A second request from the same IP while one is active is correctly
      rejected

---

## Step 3.5 — WebSocket proxy (the actual terminal connection)

Endpoint: `WS /ws/{session_id}?token=...`

1. Validate the token against the session table; reject invalid/expired
   tokens immediately.
2. Open a connection to the session clone's ttyd (reachable only via the
   controller's `vmbr_sandbox` NIC) and relay raw traffic bidirectionally
   between the browser's WebSocket and ttyd.
3. On WebSocket close (browser disconnects or visitor closes the tab):
   immediately stop and destroy the clone — don't wait for the timeout.
   Matches the "disposable over resettable" principle already established.

**Verify before continuing:**
- [ ] A real browser (or `wscat`) can connect and get a working terminal
      into a freshly cloned CT
- [ ] Closing the connection actually destroys the CT promptly — confirm
      via `pct list` immediately after disconnecting, not just trusting
      the code path ran

---

## Step 3.6 — Background reaper (the safety net)

A separate background task, independent of the per-session timers in Step
3.4/3.5, that runs periodically (e.g. every 30 seconds) and:

1. Lists actual current members of the `playground-sandbox` pool via the
   API (ground truth, not the controller's in-memory session table).
2. For any CT whose runtime exceeds max session duration + a small grace
   period, destroys it — regardless of what the controller's own bookkeeping
   thinks is happening.

This exists because the controller's in-memory session tracking would be
lost on a crash or restart, potentially orphaning running clones
indefinitely. The reaper checks reality (the pool's actual contents)
rather than trusting the controller's own state, so an orphaned clone gets
cleaned up even if the process that created it already died. This is the
same "verify, don't just trust the code path ran" principle used throughout
this project.

**Verify before continuing:**
- [ ] Manually start a session, then kill the controller process entirely
      (simulating a crash) — confirm the orphaned clone still gets
      destroyed once the reaper (on the next controller start, or as a
      standalone check) catches it
- [ ] A session within its normal duration is never touched by the reaper

---

## Step 3.7 — Deploy as a systemd service

1. Package the controller as a proper systemd unit on CT 105 (not a
   manually-run process that dies when the SSH session ends).
2. Configure `Restart=on-failure` so a crash doesn't take the whole
   playground down silently — combined with the reaper from 3.6, a
   controller restart cleans up after itself rather than leaking state.
3. Store the Proxmox API token as an environment file readable only by the
   service's user, not hardcoded in the script.

**Verify before continuing:**
- [ ] `systemctl status playground-controller` shows active/running
- [ ] Killing the process and confirming systemd restarts it automatically
- [ ] Token file permissions confirmed restrictive (not world-readable)

---

## Step 3.8 — Full end-to-end manual test

One real pass through the entire lifecycle, by hand, before this is
considered done:

1. Call `POST /sessions` for real.
2. Connect via WebSocket, get a working shell, run a few of the curated
   commands (`tour`, `status`, `neofetch`).
3. Try something explicitly disallowed (e.g. `curl`) and confirm a genuine
   `command not found`, not a fake error message.
4. Let the session run to timeout — confirm the countdown displays, the
   grace period behaves as designed, and the clone is actually destroyed
   afterward (`pct list` check).
5. Start a second session and disconnect early (close the tab) — confirm
   immediate cleanup, not a wait for timeout.
6. Try to exceed the concurrency cap with a 4th simultaneous session —
   confirm the correct rejection message.

**Verify before continuing:**
- [ ] All six scenarios above behave exactly as designed
- [ ] `pct list` after the full test shows zero leftover clones

---

## Step 3.9 — Documentation catch-up

Now that CT 105 is genuinely live as the controller, not before:

1. Repurpose `docs/services/production-documentation-engine.mdx` in
   `JaySync-Lab` to describe what CT 105 actually is now — or retire it and
   add a new `docs/services/playground-controller.mdx`, whichever reads
   better once you see the real content side by side. Update
   `services/meta.json` accordingly.
2. Update `infrastructure/inventory.yaml`'s CT 105 entry to reflect the new
   role.
3. Add an entry to the implementation log and, once this batches with other
   stable work, the changelog — same pattern as Phases 1 and 2.

---

## Open items to confirm during execution, not guessed at now

- Exact ttyd healthcheck timeout (how long to wait before declaring a
  clone failed to start) — pick a number once you see real clone/start
  timing on CT 105's hardware, don't guess in advance.
- Whether the "session ending" grace-period notice (from the original
  design doc's lifecycle table) is a controller-pushed message over the
  same WebSocket, or a separate mechanism — worth deciding during Step 3.5.
