# Homelab Playground — Implementation Log & Drift Notes

Living document. Updated as we go. Will become the basis for the post-implementation
retrospective once the playground is built and running. Captures: what we actually
did, where it diverged from the v1.2 design doc, why, and what we verified.

---

## Phase 1 — Network Foundation

**Status: ✅ Complete**

### What we did
- Confirmed storage backend: `local-lvm` (lvmthin) — matches spec assumption exactly.
- Created `vmbr_sandbox` bridge: no IP, no `bridge-ports`, isolated L2 segment.
  Appended to `/etc/network/interfaces`, applied via `ifreload -a` (no disruption to
  `vmbr0` or the active SSH/Tailscale session).
- Verified isolation empirically with a throwaway test CT (VMID 199, unprivileged,
  attached only to `vmbr_sandbox`):
  - `ping 192.168.1.1` → `Network is unreachable`
  - `ping 1.1.1.1` → `Network is unreachable`
  - `ip route` → empty (no routes at all, not even an attempted-and-blocked path)
  - This is a stronger result than the spec doc anticipated ("must fail") — there
    isn't even a route table entry to attempt through, so isolation is structural,
    not policy-based.
- Destroyed test CT 199 after verification. Confirmed VMID list clean (`pct list`).

### Drift from spec: cluster-level firewall policy — NOT applied
**Spec assumed:** Phase 1 includes enabling the Proxmox firewall with a
`policy_in: DROP` default at the cluster (datacenter) level as belt-and-suspenders
on top of bridge isolation.

**What we found instead:** CT 100 (Pi-Hole) already has `firewall=1` set on its
`net0` interface, but has **no** `/etc/pve/firewall/100.fw` file with explicit
allow-rules, and no `cluster.fw` existed at all. The Proxmox firewall engine is
currently globally inert (no enforcement happening anywhere), but `firewall=1` on
Pi-hole's interface means the *moment* the engine is turned on cluster-wide, it
would start enforcing the default policy against Pi-hole's interface too — with
no allow-rule in place for DNS (port 53), this would have silently broken
network-wide DNS resolution.

**Decision:** Did not enable `cluster.fw` / cluster-wide firewall policy.
Deferred all firewalling to **per-guest `.fw` files scoped only to the sandbox
session clones**, to be added in Phase 2. This achieves the same protection
goal (defense-in-depth on top of the already-isolated bridge) without any risk
to Pi-hole or any other existing service, since per-guest rules only affect the
guest they're attached to.

**Why this is still safe:** The bridge isolation (L4 in the design doc) is the
load-bearing control and was verified independently of any firewall policy — the
sandbox clones have no route to anywhere regardless of firewall state. The
per-guest firewall on sandbox clones is genuinely additional defense-in-depth,
not a substitute for the bridge isolation that's already proven.

**Follow-up for retrospective:** Worth deciding later (outside this project's
scope) whether Pi-hole's `firewall=1` flag should either be removed (since it's
doing nothing currently) or backed with a proper `100.fw` allow-rule for DNS, so
the lab's overall firewall posture doesn't have this latent gap. Not urgent,
not blocking — flagging so it doesn't get forgotten.

### Verification checklist (all confirmed)
- [x] `vmbr_sandbox` created, no IP, isolated from `vmbr0`
- [x] Test CT on sandbox bridge: zero route to LAN
- [x] Test CT on sandbox bridge: zero route to internet
- [x] Existing CTs/VM (100, 101, 103, 104, 105) confirmed still running, untouched
- [x] No cluster-wide firewall change made (correctly deferred — see drift note above)

---

## Phase 2 — Golden Template (VMID 180)

**Status: ✅ Complete**

### What we did
- Created CT 180 as the base container:
  ```
  pct create 180 local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst \
    --hostname sandbox-template-playground \
    --net0 name=eth0,bridge=vmbr_sandbox,firewall=1 \
    --unprivileged 1 \
    --memory 512 \
    --swap 0 \
    --rootfs local-lvm:2 \
    --features nesting=0
  ```
  `firewall=1` on `net0` is the per-guest firewall deferred from Phase 1, scoped
  only to this CT — doesn't touch Pi-hole or any other existing service.
  `swap 0` matches the spec's resource-cap reasoning (OOM kills cleanly instead
  of thrashing).
- Installed the full package set for the sandbox environment.
- **Drift found and fixed — dangerous tools gap:** initial package install
  included tools that shouldn't be reachable inside a curated public sandbox.
  Identified and stripped before proceeding further.
- **Drift found and fixed — build-time internet access:** a temporary second
  NIC (`net1`) had been attached during package installation to reach the
  package mirrors, since `vmbr_sandbox` has no route to anywhere (by design).
  This was correctly treated as temporary and *not* left in place — after
  install finished, `net1` was removed (`pct set 180 -delete net1`), confirmed
  via `pct config 180` showing only `net0`. CT 180 was then rebooted and the
  exact Phase 1 isolation test was re-run directly against it:
  - `ip -br addr show` → only `eth0` (DOWN, no link partner — expected)
  - `ping 192.168.1.1` → `Network is unreachable`
  - `ping 1.1.1.1` → `Network is unreachable`
  - `ip route` → empty
  Identical result profile to the Phase 1 disposable test CT. Isolation
  re-proven on the actual template before any further configuration — not
  just trusted because the interface was deleted.

### Resource caps and fork bomb protection
Applied on the host:
```
pct set 180 -cpulimit 1 -cpuunits 512 -memory 512 -swap 0
echo "lxc.cgroup2.pids.max: 64" >> /etc/pve/lxc/180.conf
```
Verified via `pct config 180` showing all five values present
(`cpulimit: 1`, `cpuunits: 512`, `memory: 512`, `swap: 0`,
`lxc.cgroup2.pids.max: 64`) — confirmed post-reboot, not just accepted at
write time, since raw `lxc.*` config-key syntax errors don't always surface
clearly.

**Adversarially tested with a real fork bomb** against a clone of the
template (not the golden template itself) to confirm `pids.max` actually
holds under a genuine attack rather than trusting the config alone. Caps held.

### ttyd
Installed (`ttyd version 1.7.7-40e79c7`), binary moved from
`/usr/local/bin/ttyd` to `/usr/bin/ttyd` so it resolves cleanly on `$PATH`.
Configured as a persistent service, bound to `localhost:7681` only — no
built-in ttyd auth, since per-session auth is handled by the (future) session
controller, not ttyd itself. ttyd is never meant to be reachable directly
from outside the container.

### Branding and UX polish
- Themed `help`, `tour`, and `status` commands — working end-to-end with
  colored output and section pacing.
- tmux watermark and neofetch branding customization done.
- Visual design treated as iterative/revisitable, not final — good enough to
  proceed past Phase 2 rather than polished indefinitely.


### Final verification before template conversion
Before running the irreversible `pct template 180` conversion, did one more
full pass rather than trusting prior individual checks in isolation: fresh
clone (CT 181), full visitor walkthrough, plus the resource-cap adversarial
checks re-run against the clone. Confirmed:
- Packages, dangerous-tools fix, resource caps (adversarially tested), ttyd
  persistent service, help/tour/status commands, and neofetch branding all
  working correctly on a real clone, not just the template being edited live.

### Template conversion
- `pct template 180` run — CT 180 is now a real Proxmox template. This is
  **irreversible**: CT 180 can only be cloned from going forward, never
  booted or edited directly again.
- Disposable test clone (CT 181) destroyed after serving its verification
  purpose.
- Final clone performed from the real template (a genuine fast linked clone,
  not `--full`) to confirm the "feels instant" design assumption actually
  holds — **confirmed fast (~1.5s)**, proving out the clone-per-session model
  the whole playground design depends on.

### Verification checklist (all confirmed)
- [x] CT 180 created, correct network/resource config
- [x] Dangerous-tools gap found and fixed
- [x] Build-time internet access (`net1`) removed and isolation re-verified
      directly on CT 180 post-reboot
- [x] Resource caps applied and confirmed in config
- [x] `pids.max` fork bomb protection adversarially tested and held
- [x] ttyd installed, verified, configured to localhost-only
- [x] help/tour/status commands and branding working end-to-end
- [x] Full re-verification pass done on a real clone (CT 181) before
      converting the template
- [x] Template conversion (`pct template 180`) completed
- [x] Fast linked-clone path proven post-conversion (~1.5s)

---

## Phase 3 — Session Controller

**Status: ✅ Complete**

### Step 3.1 — Decommission old CT 105

**What we did**
- CT 105 (`production-documentation-engine`) was an old, unused LXC — an
  earlier attempt at a docs engine that was never wired into anything real.
  Inspected it fully before touching it, given this project's
  manual-authorship philosophy: checked `/root`, `/home`, `/opt`, `/srv`,
  crontab, `/etc/cron.d`, systemd timers, and listening ports for anything
  that only existed on this container and was never committed to
  `JaySync-Lab` or `jaysync-lab-site`.
- Found one non-standard artifact: `/root/jaysync-build/`, a cron'd script
  (`jaysync_collector.sh`, daily at midnight) that SSHed as root back into
  the Proxmox host itself to pull `pct list`/`qm list` and regenerate a
  `WIKI_HOMEPAGE.md` plus daily JSON "snapshots" from scratch every run.
  Confirmed none of it was real authored content — both outputs were fully
  synthetic and trivially reproducible from live Proxmox state, and the
  wiki page itself described infrastructure that doesn't exist in this lab
  (an Nginx Proxy Manager node and a `hass.lab.jaysync.com` domain, neither
  of which are real). Nothing worth preserving.
- Also confirmed nothing else on the network depended on CT 105 being up:
  no listening service besides `sshd` and a loopback-only Postfix stub, no
  Pi-hole custom DNS entry referencing it, no Uptime Kuma monitor pointing
  at it.
- Destroyed CT 105 (`pct stop 105` then `pct destroy 105`) to clear VMID 105
  for reuse as the Phase 3 session controller host (Step 3.2).
- Cleaned up CT 105's SSH key from the Proxmox host's own
  `/root/.ssh/authorized_keys` — the collector script above had genuine,
  working passwordless root access from CT 105 into the host itself (its
  public key was actually present in the host's `authorized_keys`, not just
  attempted). Removed that one line; confirmed exactly one line removed
  (4 lines → 3) rather than assuming the edit was scoped correctly, and a
  timestamped backup of the original file was kept.

**Verification checklist (all confirmed)**
- [x] Content inspection done before destroying anything — no real authored
      content found, only a self-regenerating, partly-fabricated monitoring
      script
- [x] No network dependents found (listening ports, Pi-hole DNS, Uptime Kuma)
- [x] `pct destroy 105` completed; `pct list` confirms 105 is gone
- [x] VMID 105 free — `pct list` now shows only 100, 101, 104, 180 (plus 103
      as the QEMU VM)
- [x] Stale SSH key removed from the host's `authorized_keys`, with an
      exact before/after line-count check (4 → 3), not just trusted

---

### Step 3.2 — Create CT 105 as the controller host

**What we did**
- Created CT 105 dual-homed per the plan: `net0` on `vmbr0` (`192.168.1.105/24`,
  LAN-reachable), `net1` on `vmbr_sandbox` (`10.99.0.1`, the controller's own
  address on the isolated segment — the one deliberate bridge between the two
  networks). Installed Python 3.11+, pip, and a venv.

**Drift found and fixed — stale ARP entry**
The first ping to the new CT 105 at `192.168.1.105` failed 100%, even though
the CT was up. Root cause: the *old* CT 105 (destroyed in Step 3.1) had used
the same IP with a different MAC, and the host still had that MAC cached.
Fixed with `ip neigh flush dev vmbr0 to 192.168.1.105`; pings succeeded
immediately after.

**Drift found and fixed — `nesting=1` required**
`systemctl is-system-running` reported `degraded` on first boot —
`systemd-logind`, `systemd-networkd`, and `networkd.socket` were all failed.
Root cause: CT 105 wasn't created with `-features nesting=1`, and an
unprivileged LXC without nesting can't run its own systemd cgroup/namespace
stack correctly. Fixed with `pct set 105 -features nesting=1` and a restart;
confirmed `running` with 0 failed units afterward. (This exact failure mode
resurfaced later in Step 3.8 on the session-clone template — see below.)

**Verification checklist (all confirmed)**
- [x] CT 105 boots, reachable on `192.168.1.105` via `vmbr0`
- [x] `eth1` present and up on `vmbr_sandbox`, no route out (confirms same
      isolated segment as Phase 1/2)
- [x] `systemctl is-system-running` → `running`, 0 failed units (after the
      `nesting=1` fix)

---

### Step 3.3 — Proxmox resource pool, role, and API token

**What we did**
- Created the `playground-sandbox` pool, the `playground-ctrl@pve` user, the
  `PlaygroundCtrlRole` role with the privilege set from the plan, and the API
  token with `--privsep 1`. Applied the two ACL grants the plan called out up
  front (`/vms/180` and `/pool/playground-sandbox`, for both the user and the
  token).

**Drift found and fixed — three permission gaps beyond the plan's own list**
The plan anticipated one likely gap (`SDN.Use`) and got it right, but Step
3.8's real end-to-end testing surfaced two more that weren't anticipated.
All three followed the same shape — a real 403, diagnosed from the exact
error before acting, never guessed:

1. **`SDN.Use` on `/sdn/zones/localnetwork/vmbr_sandbox`** — anticipated by
   the plan itself. Even a plain Linux bridge is modeled under an implicit
   SDN zone for Proxmox's permission checks. Fixed by adding `SDN.Use` to
   the role, then granting it at that specific SDN-zone path for both user
   and token (role privilege alone wasn't enough — see point 3 below).
2. **`Datastore.AllocateSpace` on `/storage/local-lvm`** — not anticipated
   by the plan. A clone needs to allocate space on the backing storage, and
   that's a separate ACL branch from both `/vms/*` and `/sdn/*`. Diagnosed
   from the exact 403 path in the error, not guessed.
3. **The "two-place grant" trap, generalized.** The plan's own Step 3.3
   called out that both the role privilege *and* an ACL grant at the right
   path are required, and that this is a commonly-missed Proxmox gotcha.
   That turned out to be true for every one of the above — `SDN.Use` and
   `Datastore.AllocateSpace` each needed the privilege added to the role
   **and** an explicit `pveum aclmod` at their own path, separately, for
   both the user and the privilege-separated token. None of these paths
   inherit permissions from each other (`/vms/*`, `/pool/*`, `/sdn/*`,
   `/storage/*` are independent ACL branches).

**Verification**
- [x] `pveum user token permissions playground-ctrl@pve!api-token` showed
      all grants present
- [x] A real `POST /sessions` call, iterated through each 403 in turn
      (SDN.Use → Datastore.AllocateSpace → later, the `/vms/183` gap from
      the retemplate below), eventually succeeded end-to-end

---

### Step 3.4-3.7 — Controller core, WebSocket proxy, reaper, systemd deploy

**What we did**
Implemented per the plan: `POST /sessions` (cap check → per-IP check → pick
free VMID → clone → start → poll ttyd → issue token → record session),
`WS /ws/{session_id}` as a raw ttyd relay, a background reaper comparing
real pool membership/uptime against the controller's own bookkeeping, and a
systemd unit (`Restart=on-failure`, token loaded from a root-only
`EnvironmentFile`, not hardcoded). Deployed to CT 105 via `pct push` +
venv install.

**Drift found and fixed — tarball UID mapping**
The first `pct push` of the controller code failed to extract
(`Cannot change ownership to uid 197610... Invalid argument`) because the
tarball carried high UIDs from the Windows filesystem context that the
unprivileged CT's user namespace couldn't map, so `tar` couldn't apply that
ownership inside the container. Fixed with `tar -xzf ... --no-same-owner`.

**Drift found and fixed — `clone_template()` review findings, pre-Step-3.8**
Code review before running any real test caught two issues in
`proxmox_client.py`:
1. `clone_template()` passed `full=1`, forcing a full disk clone every
   session — defeating the entire point of converting CT 180 into a
   template for fast linked clones. Removed.
2. `clone.post()` returns a task UPID immediately (async); the code called
   `.config.put()` right after without confirming the clone task had
   actually finished, racing Proxmox mid-creation. Added `_wait_for_task()`
   polling against the task-status endpoint before proceeding.
Also hardened `destroy()` with `force=1` on `delete()`, as a last-resort
guarantee that a failed `stop()` doesn't leave a clone un-destroyable.

**Verification checklist (all confirmed)**
- [x] Manual `POST /sessions` clones, starts, and confirms ttyd reachability
      (after the Step 3.3 ACL gaps above were closed)
- [x] Concurrency cap and per-IP limit both return correct rejections, not a
      crash or hang (see Step 3.8 detail below)
- [x] `systemctl status playground-controller` → active/running;
      `Restart=on-failure` confirmed; token file confirmed `chmod 600`,
      root-only

---

### Step 3.8 — Full end-to-end manual test, and the bugs it actually found

This step is where "imports cleanly and is reasoned through" (the honest
status of everything above going in) became "proven against the real host,"
and it earned that distinction — three separate real bugs surfaced here,
none of them guessed at in advance, each diagnosed from concrete evidence
before being fixed.

**Bug 1 — `_wait_for_task()` too strict on `exitstatus`**
The 4th real clone attempt actually succeeded (confirmed via `pct list` /
`lvs`), but the code treated Proxmox's `"WARNINGS: 1"` exitstatus — a
benign, unavoidable systemd/nesting advisory emitted by every clone of a
`nesting=0` template — as a hard failure. Fixed to accept both `"OK"` and
any `"WARNINGS..."` exitstatus as success, raising only on anything else
(a real error string, or a missing exitstatus). Verified with a 4-case mock
test (`OK`, `WARNINGS: 1`, a real failure string, and a timeout — none of
which touch a real host) before retrying against the live API, and re-ran
identically after the later `ws_proxy.py` and template fixes below to
confirm nothing had regressed it.

**Bug 2 — ttyd bound to `127.0.0.1` only, discovered via a disposable
diagnostic clone**
The first fully successful clone+start+API-response cycle still couldn't
reach ttyd. Rather than guess, cloned a disposable diagnostic CT (182) and
checked directly: `ss -tlnp` showed `LISTEN 127.0.0.1:7681`;
`systemctl cat ttyd` showed `-i 127.0.0.1` hardcoded into the unit. Root
cause: Phase 2 built ttyd bound to loopback deliberately, before the Phase
3 controller's network design (a controller reaching clones over
`vmbr_sandbox`) existed — correct for its own phase, wrong now.

**Fix — retemplate CT 180 → CT 183**
Since the golden template itself needed to change, and `pct template` is
irreversible, this required a full retemplate rather than an in-place edit:
1. Took a full `vzdump` backup of every guest (100, 101, 103, 104, 180)
   before touching anything, per explicit approval gate for this step.
2. Cloned CT 180, replaced the hardcoded ttyd unit with a wrapper script
   (`/usr/local/bin/ttyd-start-sandbox.sh`) that binds to whatever IP the
   clone's own `eth0` actually has at boot (`ip -4 -o addr show eth0`),
   falling back to `127.0.0.1` only if that lookup comes up empty (so ttyd
   still starts rather than crash-looping, just not reachable in that edge
   case).
3. Verified the fix directly before converting anything: assigned the test
   clone a real sandbox IP, confirmed `ss -tlnp` showed it bound there
   (not loopback), and confirmed reachability with `nc` from CT 105 itself
   over `vmbr_sandbox` — not just trusting the unit file looked right.
4. Converted the fixed clone to a template at VMID 183 (`pct template`),
   destroyed the old CT 180.
5. Updated `config.py`'s `TEMPLATE_VMID` from `180` to `183`, and fixed
   `next_free_vmid()` to explicitly skip `TEMPLATE_VMID` — 183 falls inside
   `VMID_RANGE` (181-199), unlike the old 180, so an un-guarded free-VMID
   scan could have handed out the template's own VMID to a session. Caught
   this myself before it caused a real collision.
6. Both fixes deployed, and the two ACL grants that had pointed at
   `/vms/180` were re-created against `/vms/183` for both the user and the
   token (the old `/vms/180` path no longer existed post-retemplate — this
   was a fully mechanical, predictable consequence of the retemplate, not a
   new discovery like the SDN/storage gaps above).

**Bug 3 — `ws_proxy.py`: two relay bugs found only once real terminal
traffic flowed**
With ttyd now reachable, the first real WebSocket test still failed —
twice, in different ways, each fixed and re-verified before moving on:

1. **Crash on ttyd's own handshake frame.** ttyd's stock client always
   sends its initial `{AuthToken, columns, rows}` handshake as a *text*
   WebSocket frame, but `_pump_client_to_ttyd` called
   `client_ws.receive_bytes()` unconditionally — which raises on any text
   frame. This killed the relay before any real terminal I/O could happen,
   on every single connection. Fixed to accept both text and binary frames,
   forwarding each as the type it arrived in.
2. **Disconnect didn't actually destroy the clone.** `relay()` used
   `asyncio.gather(pump_a, pump_b, return_exceptions=True)`, which waits
   for *both* pump tasks to finish. When the browser disconnected, only the
   client→ttyd pump exited — the ttyd→client pump kept blocking forever,
   since ttyd has no reason to close its side just because its peer did.
   `relay()` never returned, so the `finally` block's `proxmox.destroy()`
   in `main.py` never ran. This silently defeated the "disposable over
   resettable" design entirely; it was only caught because a test clone was
   still sitting in `pct list` well after its WebSocket client had exited.
   Fixed by replacing `gather()` with
   `asyncio.wait(..., return_when=asyncio.FIRST_COMPLETED)` and explicitly
   cancelling whichever pump is still running once the other finishes.

Also added, while in this area: a `DELETE /sessions/{session_id}?token=...`
endpoint (needed for the "disconnect early" scenario below, and useful for
manual cleanup during testing), and tolerant error handling around
`proxmox.destroy()` in both the new endpoint and the WebSocket `finally`
block — a destroy racing against the reaper or a duplicate call must not
surface as an unhandled exception for what is, from the caller's
perspective, a successful teardown.

**Bug 4 — `nesting=1` regression in the new template (CT 183)**
After all of the above, session shells still didn't work: `su - guest`
hung indefinitely, even run directly via `pct exec` with no controller or
WebSocket involved at all. Isolated methodically rather than guessed:
confirmed root's own login shell worked fine on the same clone (ruling out
a host-wide issue), then confirmed the hang persisted even with
`su - guest -c 'bash --norc --noprofile -c "echo test"'` (ruling out
guest's own `.bashrc`/`.profile`, including its tmux auto-attach line).
That left PAM session setup itself, and `systemctl --failed` confirmed it:
`systemd-logind.service` was failing with `226/NAMESPACE`. Root cause: CT
183 (the new template, built via clone from CT 180) had `features:
nesting=0` — the exact same gap already fixed once before, on CT 105 itself
in Step 3.2, but it had regressed into the new golden template during the
retemplate. Fixed with `pct set 183 -features nesting=1`; confirmed
inherited correctly by fresh clones (`pct config <clone-vmid>` showing
`nesting=1`), after which `su - guest` returned instantly.

**The six scenarios, all passing after the above fixes**
1. `POST /sessions`, connect via WebSocket, run curated commands (`status`,
   `neofetch`) — real output, not fake or an echo artifact.
2. Disallowed commands (`curl`, `python3`, `gcc`) — genuine
   `-bash: ...: command not found`, confirmed as real Debian bash errors
   (those binaries are simply not installed), not synthetic messages.
3. Timeout cleanup — temporarily lowered `SESSION_MAX_DURATION_MINUTES` to
   1 and the grace period to 10s for a practical test window; reaper log
   showed `uptime 97s exceeds max 70s` and destroyed the clone; original
   config (15 min / 60s) restored after.
4. Early disconnect — destroy fired within the same second as the
   WebSocket close, confirmed via `pct list` immediately after (caught it
   mid-teardown, the same async-task-completion race flagged during
   earlier single-clone testing) and again ~10s later (fully gone).
5. Concurrency cap — 3 concurrent sessions from 3 distinct source IPs (test
   methodology note: CT 105's own multi-homed NICs — loopback, LAN,
   sandbox — were used as 3 distinct local source addresses, since testing
   from a single IP would hit the per-IP limit before the concurrency cap)
   all succeeded; a 4th got a clean `503 "at capacity"`, no crash or hang.
6. Zero leftovers — `pct list` and `lvs` both clean after the full run.

**Re-verification before merge**
Re-ran the `_wait_for_task()` mock tests (all 4 cases) against the exact
deployed code (checksum-matched to the repo) after all of the above fixes
landed — confirmed still passing, nothing in the later changes touched
that logic. Also confirmed `pct config 183` genuinely shows `nesting=1` on
the template itself, not just inferred from a passing scenario.

**Verification checklist (all confirmed)**
- [x] All six Step 3.8 scenarios behave as designed
- [x] `pct list` / `lvs` after the full test run show zero leftover clones
- [x] `_wait_for_task()` mock tests (4 cases) re-confirmed against the
      final deployed code
- [x] `pct config 183` confirmed `nesting=1` directly, not assumed

---

*(Further phases appended as we proceed.)*