# Playground Phase 4 — Public Web Interface
## Implementation Plan

Living plan, same discipline as Phases 1-3: each step has a verification
gate, confirm before moving to the next.

---

## Decisions already made

- [x] Frontend: Next.js, lives in `jaysync-lab-playground/web/`, deployed
      to Vercel at `jslnode.anujajay.com`
- [x] Backend: existing FastAPI controller on CT 105, exposed publicly via
      Cloudflare Tunnel at `api-jslnode.anujajay.com` (separate hostname
      from the frontend — two different deployments, not one)
- [x] Domain: `anujajay.com`, now on Cloudflare DNS (migrated earlier)
- [x] Email service: Resend
- [x] Notification model: ephemeral, per-outage queue — NOT a persistent
      mailing list. Emails collected while the backend is down, sent once
      each on recovery, then the queue is fully cleared. No standing list
      carries over between outages.
- [x] Architecture: frontend and backend are separate origins, connected
      via CORS — not one server serving both (this was reconsidered from
      an earlier, simpler plan once the offline-resilience requirement
      came up: if the frontend were served from CT 105 itself, it would
      go down along with the host, which defeats the entire point of
      having a graceful offline state)

---

## Architecture overview

Two independent systems that only talk to each other over the network,
never share infrastructure:

**Vercel side** (always up, regardless of home lab status):
- Next.js frontend at `jslnode.anujajay.com` — splash screen, terminal UI,
  offline state
- Vercel KV — temporary store for the email queue during an outage
- Vercel Cron — polls the backend's health on a schedule, detects the
  down→up transition, triggers the notification send

**Home lab side** (CT 105, only reachable when the host is up):
- FastAPI controller, exposed via Cloudflare Tunnel at
  `api-jslnode.anujajay.com`
- Everything already built in Phase 3 — no changes to the controller's
  core session logic, only additions (CORS, the tunnel itself)

**External:**
- Resend — actually sends the one-time recovery emails

The frontend calls the backend directly for session start/WebSocket. The
Cron job calls the backend's health endpoint independently of any visitor
being on the site — this is what makes the recovery email work even if
nobody's actively looking at the page when the host comes back.

---

## Step 4.1 — Expose the backend publicly

1. Install `cloudflared` on CT 105.
2. `cloudflared tunnel login`, `cloudflared tunnel create playground-controller`.
3. Configure ingress in `/etc/cloudflared/config.yml`:
   ```
   tunnel: <tunnel-id>
   credentials-file: /root/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: api-jslnode.anujajay.com
       service: http://localhost:8000
     - service: http_status:404
   ```
4. `cloudflared tunnel route dns playground-controller api-jslnode.anujajay.com`
5. Install as a systemd service (`cloudflared service install`).
6. Add CORS middleware to `main.py`, allowing `https://jslnode.anujajay.com`
   (and `http://localhost:3000` for local frontend dev).
7. Before any of this goes live: confirm session tokens are generated with
   a cryptographically secure random source and adequate length — this
   mattered less when the controller was LAN-only, it matters now.

**Verify before continuing:**
- [ ] `curl https://api-jslnode.anujajay.com/openapi.json` returns a real
      response, not a Cloudflare error page
- [ ] A real `POST /sessions` through the public URL clones, starts,
      returns a valid session (same four checks as every prior test)
- [ ] WebSocket relay works end-to-end through the public URL specifically
- [ ] Token generation confirmed secure before relying on public exposure

---

## Step 4.2 — Frontend scaffold

1. `web/` directory in `jaysync-lab-playground`, Next.js app.
2. Deploy to Vercel, connect `jslnode.anujajay.com`.
3. Environment variable for the backend URL
   (`NEXT_PUBLIC_API_URL=https://api-jslnode.anujajay.com`), not hardcoded.

**Verify before continuing:**
- [ ] Site deploys and loads at `jslnode.anujajay.com`
- [ ] Confirmed independent of CT 105 — the site loads even if the
      backend is manually stopped for a test

---

## Step 4.3 — Core UI

**Design philosophy, decided now so it isn't lost during build:** this is
not a generic dashboard with a terminal bolted on. The site itself needs a
distinct visual identity and interaction design — a real theme, motion,
personality — not default component-library boilerplate. Audience
assumption: an estimated 60-70% of visitors have at least some technical
background, so the UI should skip the hand-holding typically aimed at
non-technical users (no over-explained tooltips on every element, no
excessive onboarding modals, no dumbed-down copy). Trust the visitor to
understand what a terminal is and what "clone, connect, explore" means
without spelling out every step. Keep guidance concise and confident, not
absent — curious but less experienced visitors still shouldn't be lost —
just don't over-build for the lowest common denominator.

1. Splash/landing screen with the animated, "futuristic" treatment —
   real visual identity, not a stock template feel.
2. Terminal page: xterm.js instance, "Start session" button calling
   `POST /sessions`, then opening the WebSocket to the returned
   `connect_info`.
3. Session state UI: countdown timer, "at capacity" message on a 503,
   clean end-of-session state on disconnect/timeout — styled consistently
   with the rest of the site's theme, not default browser/library styling.
4. Curated command hints surfaced in the UI (matching what `tour`/`help`
   already show inside the session itself) — concise, not a tutorial wall.
5. A credits section (this is a real page/section, not boilerplate —
   worth deciding what it actually says once there's something real to
   credit).

**Verify before continuing:**
- [ ] Full real session run through the actual deployed frontend — start,
      use curated commands, disconnect — no console errors, no CORS
      failures
- [ ] Concurrency cap and disallowed-command behavior visible correctly
      in the UI, not just the raw API response

---

## Step 4.4 — Offline / maintenance detection

1. Frontend performs a lightweight health check against the backend
   (e.g. `GET /openapi.json` or a dedicated `/health` endpoint) on page
   load and periodically while idle.
2. On failure (timeout or non-2xx), render a distinct "under maintenance"
   state instead of a broken terminal or a hung "Start session" button.
3. This state is also where the email capture form lives (Step 4.5).

**Verify before continuing:**
- [ ] Manually stop the controller service on CT 105 — confirm the live
      site gracefully shows the offline state within a reasonable time,
      not a broken/hung UI
- [ ] Restart the controller — confirm the site detects recovery and
      returns to the normal state without a manual refresh (or document
      that a refresh is needed, if that's the simpler choice)

---

## Step 4.5 — Recovery notification system

**Design: push-triggered, Vercel-verified, with a slow backup poll.** Not
pure polling — the host notifies Vercel the moment it's plausibly back,
but Vercel never trusts that claim blindly; it always does its own real
check before sending anything.

1. Email capture form on the offline state (Step 4.4), submitting to a
   Vercel serverless function that writes the email into Vercel KV
   (a simple list/set keyed to "current outage").
2. On CT 105, hook an `ExecStartPost` script into the
   `playground-controller` systemd unit — fires the instant the controller
   process itself successfully starts (the precise signal that matters,
   not just "the OS booted," which doesn't guarantee the service actually
   came up).
3. That script sends one authenticated ping (shared secret, so this can't
   be spoofed or spammed from outside) to a new Vercel serverless
   endpoint, e.g. `POST /api/host-online`.
4. That endpoint does **not** trust the ping as proof. It independently
   calls the real public health check
   (`https://api-jslnode.anujajay.com/health`) through the actual tunnel —
   exactly what a real visitor would hit. If it fails (race condition:
   ping fired before the tunnel/service was fully ready), retry a couple
   of times with a short delay before giving up on this trigger.
5. Once the real check genuinely succeeds:
   - Read the full email queue from KV
   - Send one email to each address via Resend ("the playground is back
     — try it now", linking to `jslnode.anujajay.com`)
   - Clear the queue entirely after sending
   - Update a last-known-state marker in KV (used by the fallback below)
6. **Fallback safety net:** a Vercel Cron job calling the same health
   check. This exists purely for the edge case where the push ping never
   fires or never reaches Vercel (e.g. the host's network comes up before
   DNS/tunnel does, or the ping script itself fails) — without it, a
   silent push failure could leave an outage's email queue stuck
   indefinitely. This is a backstop, not the primary mechanism — the push
   path handles the overwhelming majority of real recoveries within
   seconds.
   **Decided during execution:** originally planned as hourly, but
   Vercel's Hobby plan only supports daily Cron schedules — accepted
   once-daily (`0 6 * * *`) as a deliberate tradeoff rather than
   upgrading the plan, since this is purely a backstop. Revisit if/when
   the project moves to a paid plan.
7. No email is sent unless the queue is genuinely non-empty (both paths
   funnel through the same check-and-send function), and the queue is
   only ever populated by a real visitor's own failed health check, so
   this naturally means: only on an actual outage, and only once per
   address per outage.
   **Decided during execution:** originally gated sending on comparing
   against a last-known-state marker (send only on an *observed*
   down→up transition). Found during the required "break the push path,
   confirm the fallback catches it" test that this had a real gap — the
   marker only updates when something actually calls the check, but the
   push path only ever fires *after* recovery and Cron runs at most once
   a day, so a short outage could start and fully resolve without
   anything recording it as "down" in between, leaving a real signup
   unnotified. Fixed by dropping the transition-gating and sending
   whenever the health check passes and the queue is non-empty instead —
   see `implementation-log.md` Step 4.5 for the full account.

**Verify before continuing:**
- [ ] Simulate a real outage: stop the controller, submit a test email via
      the live site's offline-state form, confirm it's actually stored in
      KV
- [ ] Restart the controller, confirm the push path fires and the
      recovery email arrives within seconds — not waiting for the hourly
      fallback
- [ ] Deliberately break the push path (e.g. temporarily wrong shared
      secret) to confirm the hourly fallback genuinely catches a missed
      push, without waiting a full hour in testing — trigger it manually
      once to prove the logic works
- [ ] Confirm the KV queue is empty afterward (not accumulating across
      outages)
- [ ] Confirm a second submission during a *different*, later outage
      requires a fresh signup — no memory of the previous outage's list

---

## Step 4.6 — Full end-to-end test

One real pass through the entire system, start to finish:
1. Visit the live site with the backend up — full session works.
2. Stop the backend — site shows offline state, email signup works.
3. Restart the backend — recovery email arrives, site returns to normal.
4. Start a real session from the recovered site, confirm everything still
   works exactly as it did before the outage.

**Verify before continuing:**
- [ ] All four stages behave as designed, in one continuous test

---

## Step 4.7 — Documentation catch-up

Same rule as every prior phase: written after the thing is real and
stable, not before.

1. Update `jaysync-lab-playground/README.md` to reflect what's actually in
   the repo now (`controller/` + `web/`), correcting the earlier
   description that undersold what's here.
2. Add a `docs/services/playground-frontend.mdx` (or fold into the
   existing playground controller page) in `JaySync-Lab`, once this phase
   is stable.
3. Changelog entries in both repos, batched at a natural stopping point,
   same as before.

---

## Open items to decide during execution, not guessed at now

- Exact health-check endpoint on the backend — reuse `/openapi.json` or
  add a dedicated `/health` (cheaper, more explicit)? Decide once the
  frontend work starts.
- Cron interval — start at 1-2 minutes, adjust based on real Vercel Cron
  pricing/limits on the plan in use.
- Whether the frontend needs a manual refresh to detect recovery, or
  should poll while in the offline state — decide based on how it feels
  in practice during Step 4.4's testing.
