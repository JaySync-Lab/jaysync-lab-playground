# CLAUDE.md — jaysync-lab-playground

**Read this first if you're starting a fresh session here.** For the full
ecosystem picture, also read `JaySync-Lab`'s `CLAUDE.md`.

## What this is

Real, disposable Linux terminal sessions in the browser — live at
**[jslnode.anujajay.com](https://jslnode.anujajay.com)**. Every visitor gets
a genuine, isolated Proxmox container, cloned from a hardened golden
template (CT 180), destroyed on disconnect. Not a simulation.

**Current version: `v1.0.0`** (tagged, released — Phase 4 complete, feature
-complete for this arc). Open/paused work is on the **`v1.1 — Future work`**
milestone: #17 (community contribution pipeline, paused), #21 (welcome
-script escape-sequence bug, real but low-priority), #23 (analytics/
security logging, deprioritized).

## Architecture

```
Visitor browser (xterm.js)
  → WebSocket → Frontend (Next.js, Vercel, web/)
    → Cloudflare Tunnel → Controller (FastAPI, controller/, CT 105)
      → clone + start → Session container (isolated, vmbr_sandbox network)
      → clones from → Golden template (CT 180, Proxmox template)
      → independent reaper sweeps up anything that overstays
```

`web/` (frontend) and `controller/` (backend) are two genuinely separate
deployables — frontend on Vercel, backend as a systemd service on Proxmox
CT 105, talking over a public Cloudflare Tunnel.

## Things that bit us before — know these before touching related code

- **Vercel preview deployments sit behind SSO/auth protection** that blocks
  automated testing (curl, Playwright — anything not logged into the
  Vercel dashboard). Real end-to-end tests for recent features (the
  feedback form, the email notifications, the scrollbar fix) were run
  **post-merge against production**, not pre-merge on preview, by explicit
  agreement each time this came up. Don't assume you can test a preview
  URL programmatically — you likely can't.
- **`.scanline-overlay` needs `overflow-hidden` on its container**, or you
  get a scrollbar that flickers in sync with its 6s animation. Root-caused
  via direct `document.documentElement.scrollHeight` measurement (grew
  792px→1558px in lockstep with the animation, snapped back on loop) —
  not guessed. Two pages (`/feedback`, `/not-found`) were missing it; the
  homepage already had it correctly. If you add another page using this
  class, check for `overflow-hidden` on the same element.
- **Rate-limit testing pollutes shared IPs.** `checkRateLimit()` in
  `lib/feedback.ts` is per-IP (3/hour, fixed window, Upstash Redis). If
  your dev/test environment shares an egress IP with a real tester (this
  happened once — my own e2e test traffic exhausted the quota right
  before the person testing tried it for real), check
  `redis.keys("feedback:ratelimit:*")` before assuming a 429 is a bug.
- **The mobile Ctrl toolbar passing Playwright's mobile-viewport emulation
  does NOT mean it works on a real phone.** It didn't, once — iOS Safari's
  dynamic viewport chrome (address bar show/hide) miscalculates `vh` units
  differently than any emulator. Fixed with `position: fixed` + `dvh`
  units + `env(safe-area-inset-bottom)`, confirmed only after testing on
  actual hardware. Don't trust emulated mobile tests alone for anything
  involving `vh`, fixed positioning, or the on-screen keyboard.
- **`GITHUB_FEEDBACK_TOKEN` is scoped to `Issues: Read/write` on this repo
  only** (fine-grained PAT). It cannot touch code, other repos, or PRs.
  If the feedback form ever needs to do more (e.g. comment on issues),
  that's a new, explicitly-scoped token, not a widened one.
- **Feedback issue bodies never contain the submitter's email** — that's
  the actual point of the feature, not incidental. Email is stored
  separately in KV (`feedback:email:{issueNumber}`), reachable only by
  that exact key. If you touch `lib/feedback.ts`, keep that boundary
  intact — it was deliberately designed and tested (grepped raw GitHub API
  responses to confirm zero leakage before shipping).

## Tech stack

**Frontend** (`web/`): Next.js 16 · React 19 · xterm.js · Tailwind CSS 4 ·
`@upstash/redis` · Vercel hosting.
**Backend** (`controller/`): FastAPI · Uvicorn · `proxmoxer` · `websockets`
(Python), systemd service, `Restart=on-failure`.
**Infra**: Proxmox VE (LXC clone-per-session) · Cloudflare Tunnel ·
Upstash Redis (KV) · Resend (transactional email).

## Safety model (don't relax these without a real reason)

- **Disposable over resettable** — every session destroyed on disconnect,
  never reused.
- **Isolated** — sessions sit on `vmbr_sandbox`, no route to the LAN or
  internet.
- **Bounded** — resource caps, fork-bomb protection, 15 min / 3 concurrent
  / 1-per-visitor limits.
- **Least-privilege credentials** — every Proxmox token/role and every
  external API token (GitHub, Resend) is scoped to exactly what it needs,
  nothing more. New credentials get their exact scope shown for explicit
  sign-off before creation.

## Where to look next

- [`README.md`](README.md) — architecture diagram, repo layout
- [`implementation-log.md`](implementation-log.md) — the real detailed
  history: root causes, what broke, how it was actually verified. This is
  the primary "how did we get here" document for this repo
- [`playground-phase3-session-controller-plan.md`](playground-phase3-session-controller-plan.md) /
  [`playground-phase4-web-interface-plan.md`](playground-phase4-web-interface-plan.md) —
  original build plans, mostly historical now (both phases are done)
- [JaySync-Lab's CHANGELOG.md](https://github.com/JaySync-Lab/JaySync-Lab/blob/main/CHANGELOG.md) —
  ecosystem-wide, dated summary
