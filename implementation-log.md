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

### Post-Phase 3 cleanup — golden template restored to VMID 180

**What we did**
Once the CT 180→183 retemplate from Step 3.8 was fully proven against the
real host, moved the golden template back to VMID 180. This is a cosmetic/
organizational fix, not a functional one: 183 worked correctly, but it fell
*inside* `VMID_RANGE` (181-199) — the session-clone range — unlike the
original 180, which sat outside it. That meant `next_free_vmid()` needed an
explicit carve-out to avoid ever handing 183 out as a session VMID, which
was correct but was extra state to keep in sync. Moving the template back
to 180 removes that carve-out entirely and matches the VMID convention
Phase 2 originally established.

Procedure: cloned CT 183 → CT 180 (`pct clone 183 180`), verified the
clone before converting anything, converted CT 180 to a template
(`pct template 180`), re-pointed the two `/vms/*` ACL grants from `/vms/183`
to `/vms/180` for both the user and the token, updated `config.py`
(`TEMPLATE_VMID = 180`) and simplified `next_free_vmid()` to drop the
now-unnecessary skip, redeployed to CT 105, and re-ran a full real
`POST /sessions` test against the new CT 180 template before destroying
CT 183.

**Drift found and fixed — stale network config baked into CT 183**
Verifying the CT 183→180 clone before conversion (per this project's
"verify before the irreversible step" discipline) turned up something the
plan's own expected checklist didn't anticipate: `ss -tlnp` showed ttyd
already bound to `10.99.0.183:7681` immediately after a bare `pct start`,
when it should have shown no binding yet (no IP assigned pre-controller).
Root cause: `/etc/network/interfaces` inside the clone had a **hardcoded
static IP (`10.99.0.183` — the old template's own address, not a
placeholder) and a phantom `eth1 dhcp` stanza** referencing a NIC that
doesn't even exist in this container's actual Proxmox config. Both were
leftover from the manual diagnostic verification done during Step 3.8's
original CT 180→183 retemplate (a real sandbox IP was assigned directly to
that test clone to verify the ttyd wrapper script), never cleaned up before
that clone was converted to the CT 183 template — so every clone of CT 183
inherited it. This didn't cause visible failures in the real controller
flow, since `clone_template()` always sets a fresh `net0` IP on every real
session clone, and Proxmox rewrites this same file to match — but it would
have baked stale, wrong network config into yet another golden template,
and would confuse anyone doing a manual diagnostic clone the way Step 3.8's
Bug 2 was originally found (a bare `pct start` with no controller
involved). Same category of issue as Phase 2's own build-time `net1`
cleanup before its template conversion. Fixed by rewriting
`/etc/network/interfaces` to a clean `eth0 manual` state (no static IP, no
`eth1` stanza) and rebooting before converting to a template; re-verified
`ip -br addr show` showed only `eth0` with no IPv4 (link-local only,
matching the original Phase 2 baseline) and ttyd correctly fell back to
`127.0.0.1` per its documented fallback behavior.

**Verification checklist (all confirmed)**
- [x] `pct clone 183 180` confirmed as a real linked clone (`lvs` showed
      `Origin base-183-disk-0`)
- [x] Stale network config found and fixed before template conversion;
      re-verified clean (`nesting=1`, no baked-in IP, `systemctl
      is-system-running` → `running`, 0 failed units)
- [x] `pct template 180` completed
- [x] ACL grants moved from `/vms/183` to `/vms/180` for both user and
      token; `pveum acl list` confirmed exactly 8 entries, none referencing
      `/vms/183`
- [x] `config.py`/`proxmox_client.py` updated and redeployed; checksums
      confirmed matching between the repo and CT 105
- [x] Full real `POST /sessions` test against the new CT 180 template:
      clone sourced from `base-180-disk-0` (linked, not full), ttyd
      reachable, real API response, curated commands (`status`, `neofetch`,
      `tour`) all working end-to-end
- [x] CT 183 destroyed only after the above was fully verified; `pct list`
      and `lvs` confirmed no trace of it remaining

---

## Phase 4 — Public Web Interface

**Status: In progress**

### Step 4.1 — Expose the backend publicly

**What we did**
- Before touching any networking: reviewed `sessions.py`'s token
  generation (`secrets.token_urlsafe(16)` for `session_id`, 128 bits;
  `secrets.token_urlsafe(32)` for the actual auth `token`, 256 bits) —
  confirmed it already used a cryptographically secure source (`secrets`,
  backed by `os.urandom`) with more than adequate length. This was sound
  before any public exposure, no fix needed there.
- While reviewing the surrounding validation logic, found a related gap
  worth closing before going public: both `DELETE /sessions/{id}` and
  `WS /ws/{session_id}` validated the token with a plain `session.token !=
  token` comparison, which is not constant-time in CPython — a timing
  side-channel that becomes a real (if narrow) concern once this endpoint
  is reachable from the open internet instead of LAN-only. Fixed both call
  sites to use `secrets.compare_digest()` instead.
- Installed `cloudflared` on CT 105, authenticated via `cloudflared tunnel
  login` (browser auth, completed by the human operator), created the
  `playground-controller` tunnel, configured `/etc/cloudflared/config.yml`,
  routed DNS, and installed `cloudflared` as a systemd service.
- Added CORS middleware to `main.py`, allowing `https://jslnode.anujajay.com`
  (the eventual frontend origin) and `http://localhost:3000` (local
  frontend dev against the real backend).

**Drift found and fixed — `curl` not installed on CT 105**
CT 105 (the controller host itself, not a session sandbox) doesn't have
`curl` — only `wget`. This isn't the sandbox's deliberate curated-command
restriction (this is infrastructure, not a visitor session); it simply
was never installed during Step 3.2's setup. Used `wget` for the
`.deb` download and initial diagnostics instead of blocking on installing
`curl` — no functional impact, just noted for anyone doing future manual
diagnostics on CT 105 directly.

**Drift found and fixed — subdomain nesting broke TLS entirely**
The original plan specified `api.jslnode.anujajay.com` for the tunnel
hostname. After DNS and the tunnel connection were both confirmed healthy
(tunnel showed 4 registered QUIC connections; DNS resolved correctly to
Cloudflare's anycast IPs from multiple independent resolvers), every
request to it failed at the TLS handshake stage — confirmed identically
across three independent TLS stacks (CT 105's GnuTLS via `wget`, a local
Windows `schannel`-based `curl`, and raw `openssl s_client`), all reporting
alert 40 (handshake failure). Other hostnames on the same zone
(`anujajay.com`, `lab.anujajay.com`) worked fine, isolating the problem to
this one new hostname specifically. Waited and retried across ~20 minutes
in case this was Universal SSL cert (re-)provisioning taking time for a
new hostname pattern — it wasn't. Root cause, confirmed once diagnosed
correctly: Cloudflare's free Universal SSL wildcard cert (`*.anujajay.com`)
only covers **one** subdomain level. `jslnode.anujajay.com` would be
covered; `api.jslnode.anujajay.com` — a second level of nesting — is not,
and would need either an Advanced Certificate Manager entry or a
`*.jslnode.anujajay.com` wildcard, neither of which existed. Fixed by
renaming the hostname to `api-jslnode.anujajay.com` (single-level,
hyphenated instead of nested), which is covered by the existing wildcard
with no cert changes needed. Confirmed this was the actual root cause, not
a lingering propagation issue: the corrected hostname worked on the very
first request, no delay. Updated `/etc/cloudflared/config.yml`, deleted
the old DNS CNAME (dashboard, since `cloudflared`'s CLI has no `route dns`
removal command), created the new one, and updated
`playground-phase4-web-interface-plan.md`'s references (7 occurrences
across the architecture overview and Steps 4.1/4.2/4.5) to match.

**Verification (Step 9, all real, against the actual public URL — not
loopback)**
- `curl https://api-jslnode.anujajay.com/openapi.json` → real `200 OK`
  with genuine OpenAPI JSON content, not a Cloudflare error page
- Real `POST /sessions` through the public URL → real `200 OK`,
  `session_id`/`token`/`connect_info` returned in ~11.4s (consistent with
  prior clone+start+ttyd-healthcheck timing); `lvs` confirmed the clone as
  a genuine linked clone (`Origin base-180-disk-0`, not a full copy)
- WebSocket relay tested through the actual public `wss://` URL from an
  external client (not CT 105 looping back to itself) — real banner, real
  shell prompt, `status` command executed and returned genuine curated
  output
- Clone auto-destroyed on client disconnect (the Step 3.8 relay-teardown
  fix still holding under real public-internet conditions); `pct list` and
  `lvs` both confirmed clean afterward

**Verification checklist (all confirmed)**
- [x] Token generation confirmed secure before relying on public exposure
      (was already sound; timing-safe comparison added as a related
      hardening fix)
- [x] `curl https://api-jslnode.anujajay.com/openapi.json` returns a real
      response, not a Cloudflare error page
- [x] A real `POST /sessions` through the public URL clones, starts, and
      returns a valid session (linked clone confirmed, not full)
- [x] WebSocket relay works end-to-end through the public URL specifically
- [x] Test clone destroyed; `pct list`/`lvs` confirmed clean

---

### Step 4.2 — Frontend scaffold

**What we did**
- Scaffolded a new Next.js app in `web/` (App Router, TypeScript,
  Tailwind v4, `src/` layout with the `@/*` path alias) via
  `create-next-app`, matching `jaysync-lab-site`'s general stack style
  (Next.js + TypeScript + Tailwind, `src/app/`). Next.js 16 / React 19
  were picked up as the current latest rather than pinning to
  `jaysync-lab-site`'s exact versions — no shared dependency between the
  two projects requires them to match.
- Replaced the `create-next-app` default homepage with a minimal
  placeholder ("JaySync-Lab Playground / Coming online.") and updated the
  page metadata (title/description) — deliberately no real design yet,
  per this step's scope.
- Added `NEXT_PUBLIC_API_URL=https://api-jslnode.anujajay.com` as an
  environment variable, not hardcoded anywhere — confirmed via a full
  grep of `src/` for the API hostname (no hits; the placeholder page
  doesn't call the backend at all yet, so the variable isn't consumed by
  any code until Step 4.3, but it's in place and gitignore-correct:
  `.env.local` (real value, git-ignored) plus a tracked `.env.example`,
  which needed an explicit `!.env.example` negation added to
  `create-next-app`'s default `.env*` ignore pattern.
- Created a new Vercel project (`jslnode`, under the same
  `anuja-jayasinghes-projects` scope as `jaysync-lab-site`), registered
  `NEXT_PUBLIC_API_URL` in all three Vercel environments (production,
  preview, development), and deployed to production.
- Connected the custom domain `jslnode.anujajay.com`. Vercel required a
  DNS `A` record (`jslnode.anujajay.com` → `76.76.21.21`) on the zone's
  actual DNS provider (Cloudflare) — added directly by the human operator
  in the Cloudflare dashboard (DNS-only/grey-cloud, not proxied, so
  Vercel terminates TLS for this hostname directly rather than layering
  Cloudflare's proxy on top of it, avoiding the kind of cert-coverage
  confusion Step 4.1 just went through on the backend subdomain).

**Verification**
- `nslookup jslnode.anujajay.com` → resolves correctly to Vercel's edge
  (`76.76.21.21`)
- `curl https://jslnode.anujajay.com/` → real `200 OK`, correct page
  title/metadata, the actual placeholder content rendered server-side
- Confirmed no hardcoded backend URL anywhere in `src/` (grep, zero hits)

**On the "independent of CT 105" check (Step 4.2's plan item 5, 2nd
bullet):** this step's placeholder page makes **zero calls to the
backend** — no fetch, no API call, fully static prerendered content. So
stopping the controller service right now would prove nothing (the page
would load identically either way, since it never talks to CT 105 at
all). Confirmed via the same `src/` grep above rather than assumed. This
check only becomes meaningful once Step 4.3 wires up the terminal UI to
actually call `POST /sessions` — deferring the "stop the controller and
confirm the site still loads" test to that step instead of running it
now against a page that can't fail it either way.

**Verification checklist**
- [x] `web/` scaffolded, builds and runs cleanly (local `next build` and
      a local production-server smoke test both confirmed before
      deploying)
- [x] `NEXT_PUBLIC_API_URL` present as an env var, not hardcoded anywhere
- [x] Deployed to Vercel as a new project, custom domain connected
- [x] Site loads at `https://jslnode.anujajay.com` with real content
- [ ] Independence-from-CT-105 check — deferred to Step 4.3 (not
      meaningful yet; see note above)

---

### Step 4.3 — Core UI

**What we did**
- Splash/landing section: dark theme, scanline + grid overlay, glow-text
  headline, CSS-only animation (no heavy motion library added yet) —
  real visual identity per the plan's design philosophy note, not
  default component-library boilerplate.
- Terminal page: `PlaygroundTerminal.tsx`, a client component wrapping
  `@xterm/xterm` + `@xterm/addon-fit`. Replicates ttyd's wire protocol
  directly (confirmed against the real backend during Phase 3 testing):
  a JSON handshake (`{AuthToken, columns, rows}`) sent as the first text
  frame, then binary frames with a one-byte `'0'` command prefix for
  input/output in both directions.
- Session state UI: "Start session" button calling `POST /sessions`,
  status line showing connecting/active/ended/error states, a
  client-side countdown timer. The countdown is an approximation (15
  minutes, matching `SESSION_MAX_DURATION_MINUTES`'s default) — the API
  doesn't return an expiry timestamp, so this isn't authoritative; the
  server enforces the real timeout regardless of what the client-side
  timer shows.
- Curated command hints (`tour`, `status`, `neofetch`) surfaced as a
  short caption under the terminal, not a tutorial wall.
- Credits/footer section linking back to the lab's docs site and this
  repo.

**Verification — real, against the actual deployed frontend, not
mocked**
Used Playwright (headless Chromium) to drive a genuine browser session
against `https://jslnode.anujajay.com` rather than trusting the code
read correctly:
- Loaded the live page, clicked "Start session" for real, waited for the
  UI to report the session active
- Real ttyd banner rendered inside the xterm.js instance, typed `status`
  via real keyboard events, got the real curated response back
- Zero console errors, zero page errors, zero failed network requests,
  no CORS failures
- Navigated away to trigger a real disconnect; confirmed via `pct list`/
  `lvs` that the clone was destroyed (the Step 3.8 relay-teardown fix
  still holding through this new frontend + tunnel path)

**Drift found and fixed — stale session blocking the first real test**
The first Playwright run against production got a `429` immediately —
diagnosed via the controller's own logs rather than guessed: an earlier,
disconnected `POST /sessions` call from a manual `curl` test during Step
4.1 had never been paired with a WebSocket connection, so it was never
cleaned up and was still holding my test IP's per-IP slot. Destroyed the
orphaned clone directly and restarted the controller to clear the stale
in-memory session table before retrying — after which the real test
passed cleanly.

**Finding — the multi-source-IP concurrency test technique from Step
3.8/4.1 no longer works through the public tunnel**
Tried to verify the "at capacity" UI path using the same trick used
before (binding outbound requests on CT 105 to different local
interfaces to present distinct source IPs). It doesn't work anymore now
that traffic goes through the Cloudflare Tunnel: all of CT 105's
outbound requests NAT to the same single public IP regardless of local
bind address, so every attempt was seen as the same source by the
controller; and the sandbox NIC (`10.99.0.1`) has no route to the
internet at all by design, so binding to it just hung forever with no
response (confirmed via `ps aux` showing the process still alive with no
progress, not assumed). Cleaned up the hung process and the one orphaned
clone it did create before it hit the per-IP limit. Didn't force a
replacement test methodology for this one check — the backend's
concurrency logic itself was already proven correct in Step 3.8's real
multi-session test, and the frontend's handling of a 503 (`CapacityError`
→ the "at capacity" message) is straightforward reviewed code, not
runtime behavior that needed independent proof the way the WebSocket
relay protocol did.

**Verification checklist**
- [x] Full real session run through the actual deployed frontend — start,
      curated command, disconnect — no console errors, no CORS failures
- [x] Clone destroyed on disconnect; `pct list`/`lvs` confirmed clean
- [~] Concurrency cap behavior in the UI — code-reviewed (not
      independently runtime-tested against production; see finding above
      for why the usual multi-IP test technique doesn't apply anymore)

---

### Step 4.4 — Offline / maintenance detection

**What we did**
- Added a dedicated `GET /health` endpoint to `main.py` — deliberately
  cheap (no Proxmox calls, no OpenAPI schema generation), just confirms
  the process is up. Picked this over reusing `/openapi.json` per the
  plan's own open item ("reuse `/openapi.json` or add a dedicated
  `/health`? ... cheaper, more explicit").
- `checkHealth()` in `lib/api.ts` now hits `/health` with a 5s
  `AbortController` timeout, so a genuinely hung/unreachable backend
  resolves to "offline" within a bounded time rather than hanging the
  check indefinitely.
- `useBackendHealth()` hook: polls on mount and every 15s while idle,
  paused entirely while a session is connected (an open WebSocket is
  already proof the backend is up — no reason to poll on top of it, and
  it keeps a health-check blip from ever interrupting an active session).
- `OfflineState` component renders in place of the terminal controls when
  the poll reports the backend down and no session is in flight. The
  xterm.js container itself stays mounted (hidden via CSS, not
  unmounted) so the persistent `Terminal` instance set up on first mount
  never gets torn down and rebuilt.
- Reserved, clearly-commented spot in `OfflineState` for Step 4.5's email
  capture form — not built yet, deliberately.

**Verification — live, not simulated**
Rather than trust the polling logic by reading it, ran the actual
down→up transition against the real deployed site with a single
long-lived Playwright browser tab spanning the whole thing (no reload in
between, which is the part that actually matters here):
1. Stopped `playground-controller` on CT 105 for real
   (`systemctl stop`), confirmed via `curl` that `/health` genuinely
   returned `502` through the tunnel
2. Loaded `https://jslnode.anujajay.com/` fresh while the backend was
   down — offline state appeared in ~2.5s, not a hang or a broken UI
3. Restarted `playground-controller` for real
   (`systemctl start`) while that same browser tab stayed open
4. The same tab, with no reload, returned to the normal "Start session"
   state ~30s later (consistent with the 15s poll interval plus restart
   time) — confirming recovery detection genuinely works without a
   manual refresh, not just documenting it as an acceptable fallback

**Verification checklist (all confirmed)**
- [x] Manually stopped the controller; live site gracefully showed the
      offline state within a reasonable time (~2.5s), not a broken/hung
      UI
- [x] Restarted the controller; site detected recovery and returned to
      normal without a manual refresh (~30s, same browser tab throughout)

---

### Step 4.5 — Recovery notification system

**Status: ✅ Complete**

**What we did**
- `POST /api/subscribe` (Vercel serverless): validates and queues an
  email in a Redis SET (Vercel KV, delivered as the Upstash for Redis
  marketplace integration — the modern successor to the old standalone
  "Vercel KV" product) keyed to the current outage.
- `POST /api/host-online`: the push receiver. Validates a shared secret
  (`HOST_ONLINE_SECRET`), then — critically — never trusts the ping as
  proof of anything; always does its own real health check against
  `https://api-jslnode.anujajay.com/health` before considering sending
  anything, retrying up to 3 times (3s apart) to cover the race where
  the ping fires the instant the process starts, slightly ahead of the
  tunnel being fully ready.
- `GET /api/cron/health-check`: the fallback safety net, validated by a
  separate `CRON_SECRET` (Vercel's standard auto-attached-Bearer-token
  pattern for scheduled functions).
- Both funnel through one shared function
  (`checkAndNotifyIfRecovered()`): real health check, and — see the drift
  note below — sends whenever the check passes and the queue is
  non-empty, clearing the queue after every send.
- CT 105: `ExecStartPost=-/usr/local/bin/notify-host-online.sh` added to
  `playground-controller.service`, firing on every successful start
  (manual restart, `Restart=on-failure` auto-restart, or boot). The
  leading `-` and the script's own unconditional `exit 0` both ensure a
  failed ping can never fail the unit itself.
- `HOST_ONLINE_SECRET` added to `/etc/playground-controller/controller.env`
  (chmod 600, root-only, confirmed not assumed) — `ExecStartPost`
  commands share the parent unit's `EnvironmentFile`, so no separate
  credentials file was needed.

**Drift found and fixed — CT 105 never auto-started after the host's
real outage**
While resuming this step (see the real-outage note in Step 4.4's
context — the Proxmox host was genuinely down for several hours during
this phase), found CT 105 itself was `stopped` after the host came back,
while CT 100/101/104 had all auto-started. `pct config 105` showed no
`onboot` line at all (defaults to disabled), unlike the others. This
directly undermines the resilience story Phase 4 is built around — a
host reboot would otherwise leave the whole playground down until
someone manually starts CT 105. Fixed with `pct set 105 -onboot 1`.

**Drift found and fixed — ExecStartPost couldn't write its own log file**
First deploy of `notify-host-online.sh` logged to `/var/log/...`, but
`ExecStartPost` runs as the unit's unprivileged `User=playground-ctrl`
(inherited from `[Service]`), which can't write to `/var/log/`. Failed
silently — the script's own `exit 0` swallowed the permission error,
so nothing looked wrong until the log file was checked and found
missing entirely, then confirmed via `journalctl` showing "Permission
denied". Fixed by dropping the separate log file and letting stdout/
stderr flow to the journal like everything else in this unit.

**Drift found and fixed — a real gap in the send-trigger logic, caught
by the plan's own required "break the push path" test**
The original design gated sending on an observed `down`→`up` transition
via a `backend:last_state` KV marker. Testing the plan's explicit
"deliberately break the push path, confirm the fallback catches it"
scenario exposed a real hole: `last_state` only changes when something
actually *calls* `checkAndNotifyIfRecovered()` — but the push path only
ever fires *after* recovery (never during an outage), and Cron runs at
most once a day (see the tradeoff note below). A short outage that
starts and fully resolves without anything probing state in between
never gets recorded as `down` at all, so recovery is never recognized as
a transition — a real signup could sit in the queue and simply never get
notified. Caught this empirically: manually stopped the controller,
signed up for real, broke the push secret, restarted (confirmed the bad
ping was correctly rejected before touching any state), then manually
triggered the Cron endpoint expecting it to catch the missed
notification — it returned `transitioned: false, emailsSent: 0` despite
a real queued signup, proving the gap rather than assuming it. Fixed by
dropping the transition-gating entirely: now sends whenever the real
health check passes **and the queue is non-empty**. The queue itself is
the correct signal — it can only be non-empty because a real visitor's
health check genuinely failed at some point, and it's fully cleared
after every send, so per-outage isolation holds without needing a
separate state marker to gate on. `last_state` is kept only as an
informational record, not as a send condition. Redeployed and re-ran
the exact same manual Cron trigger against the same still-queued real
signup — this time correctly returned `transitioned: true, emailsSent: 1`.

**Decision made during execution — Cron interval**
Plan called for hourly; Vercel's Hobby plan only permits daily Cron
schedules. Accepted `0 6 * * *` (once daily) as a deliberate tradeoff
rather than upgrading the plan — this job is explicitly a backstop, not
the primary mechanism (the push path handles real recoveries within
seconds), so a 24-hour worst-case window on the fallback alone was
judged acceptable. Also see `playground-phase4-web-interface-plan.md`
Step 4.5 for the same note in context.

**Verification — all real, none simulated, spanning an actual live
outage of the Proxmox host**
- A genuine, unplanned multi-hour host outage occurred during this
  phase (see Step 4.4's note on the host being independently confirmed
  down via Tailscale/SSH/tunnel 502s). Signed up a real email address
  while it was genuinely down; confirmed stored in KV
  (`redis.smembers`) directly, not assumed from the API response alone
- Once the host came back and CT 105/the controller were confirmed
  healthy again: restarted the controller for real — the push path
  fired, its own real health check passed, found the real queued
  signup, and sent one real email via Resend, all within ~8 seconds of
  the restart; confirmed via `journalctl` showing
  `{"healthy":true,"transitioned":true,"emailsSent":1}` and the KV
  queue empty immediately after
- Deliberately broke `HOST_ONLINE_SECRET` on CT 105, created a second
  real outage (stopped the controller, signed up again), restarted with
  the bad secret — confirmed the push request was rejected (401) before
  ever touching the queue or sending anything (queue still held the
  signup afterward)
- Manually triggered `/api/cron/health-check` with its real secret to
  simulate the daily fallback firing (per the plan's own explicit
  allowance to trigger it manually rather than wait for the real
  schedule) — this is what surfaced the transition-gating bug above;
  after the fix, confirmed it correctly caught the missed notification
  and sent the real email
- Restored the correct `HOST_ONLINE_SECRET`, restarted once more with an
  empty queue — confirmed `transitioned: false, emailsSent: 0`, i.e. a
  routine restart does not send a spurious email
- Confirmed via direct KV inspection after every step, not inferred from
  API responses alone

**Verification checklist (all confirmed)**
- [x] Simulated a real outage: stopped the controller, submitted a test
      email via the live site's offline-state form, confirmed it was
      actually stored in KV
- [x] Restarted the controller; push path fired and the recovery email
      arrived within seconds — confirmed via journal and KV, not
      assumed from a 200 response alone
- [x] Deliberately broke the push path (wrong shared secret); confirmed
      the fallback genuinely catches a missed push — found and fixed a
      real bug in the process rather than the test passing by luck;
      triggered manually rather than waiting for the real daily schedule
- [x] Confirmed the KV queue is empty after every send, not accumulating
      across outages
- [x] Confirmed a second, later outage's signup is isolated from the
      first (queue was empty before the new signup in every case,
      confirmed directly via KV)

---

### Step 4.6 — Full end-to-end test

**Status: ✅ Complete**

**What we did**
One continuous pass through the entire system, live against production,
rather than re-stitching together the separate tests each earlier step
already ran individually. Confirmed clean baseline first (`pct list`
empty of session clones, KV queue empty, `last_state: up`), then ran all
four stages in order without interruption:

1. **Backend up, real session:** loaded `https://jslnode.anujajay.com/`,
   clicked "Start session" for real, got a real WebSocket-connected
   terminal, ran `neofetch`, got genuine output. Zero console errors,
   zero failed requests. Navigated away to disconnect; confirmed the
   clone was destroyed (`pct list`/`lvs` clean).
2. **Backend down, real signup:** stopped `playground-controller` for
   real. Loaded the site fresh — offline state appeared. Submitted a
   real email through the live form; confirmed both the UI's "Got it"
   confirmation and the actual KV queue entry (not just the UI's word
   for it).
3. **Recovery, real push:** restarted the controller for real. The
   `ExecStartPost` hook fired, its own real health check passed, found
   the real queued signup, and sent one real email — confirmed via
   `journalctl` (`{"healthy":true,"transitioned":true,"emailsSent":1}`)
   and the KV queue empty immediately after.
4. **Post-recovery session, same tab, no reload:** the *same* browser
   tab that had been sitting on the offline state (not a fresh page
   load) detected recovery ~44s after the restart and returned to the
   normal "Start session" UI on its own. Started a brand-new real
   session from that recovered state, ran `status`, got genuine curated
   output — confirming the system works exactly as it did before the
   outage, not just that individual pieces independently pass in
   isolation.

No code changes were needed for this step — every underlying piece had
already been individually proven in Steps 4.1-4.5; this step's value was
specifically in proving they all still work correctly *together*, in one
uninterrupted real cycle.

**Verification checklist (all confirmed)**
- [x] Stage 1 (backend up): real session, real terminal, real command
      output, zero console errors, clean teardown on disconnect
- [x] Stage 2 (backend down): offline state shown, real signup submitted
      and confirmed in KV
- [x] Stage 3 (recovery): real push-triggered email sent, confirmed via
      journal and KV
- [x] Stage 4 (post-recovery): same tab detected recovery without a
      reload, and a fresh real session worked identically to Stage 1
- [x] `pct list`/`lvs` confirmed clean after the full run

---

### Post-4.6 — Vercel Git auto-deploy connected

`jslnode` was never actually connected to Git-based auto-deploy — every
production deploy up to this point was a manual `vercel deploy --prod`
from local working-tree state, which is exactly why the
`phase4-frontend-polish` merge silently never went live (see the round-2
bugfixes entry above). Root cause confirmed via `vercel git connect`
itself refusing to proceed: `jaysync-lab-playground` was private and
org-owned, which Vercel's Hobby plan doesn't support for Git
integration — confirmed by comparing against `jaysync-lab-site`'s
backing project (`jaysync-lab`), also org-owned but public, which does
have a working Git connection.

Made the repo public (`gh repo edit --visibility public
--accept-visibility-change-consequences`), confirmed via both an
authenticated `gh api` call and a fully unauthenticated `curl` request
to GitHub's public API (`private: false`, `HTTP 200` with no auth
header — not just trusted the settings page). Reconnected
(`vercel git connect`), then set the project's Root Directory to `web`
via the dashboard (the CLI's `project update` command has no
root-directory flag in this version, and deliberately did not attempt
to extract the CLI's stored auth token to hit the API directly around
that gap) — required since the Next.js app lives in a subdirectory of
this repo, not the repo root, and Git-triggered builds need to know
that explicitly (CLI-only deploys never needed it, since they always
ran from inside `web/`).

This entry is itself the test commit proving it: pushed directly to
`main`, no `vercel deploy` run manually — if you're reading this on the
live site, the deploy fired automatically.

---

*(Further phases appended as we proceed.)*