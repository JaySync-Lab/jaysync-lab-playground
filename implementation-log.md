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

**Status: Not started**

---

*(Further phases appended as we proceed.)*