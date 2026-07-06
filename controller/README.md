# Playground Session Controller

Implements Steps 3.4-3.7 of `../playground-phase3-session-controller-plan.md`.
Steps 3.1-3.3 and 3.8 (decommissioning old CT 105, creating the new CT 105,
the Proxmox pool/role/token, and the full end-to-end test) are paused until
the Proxmox host is back online — see `../PHASE3_EXECUTION_BRIEF.md`.

## Status: UNTESTED-PENDING-HOST

Every file below has been checked structurally only: it imports cleanly,
`main.py` builds a valid FastAPI app object, and there are no syntax or
obvious logic errors on inspection. **Nothing here has run against a real
Proxmox host, a real ttyd instance, or a real browser.** Do not treat any
of this as "working" until Steps 3.3-3.8 actually pass — see each file's
own docstring for exactly what's unverified in it.

## Layout

- `app/config.py` — env-driven configuration, including several
  placeholder values the plan explicitly defers to real-host timing data
  (session duration, ttyd healthcheck timeout) and one networking
  assumption not specified in the plan (static IPs for clones on
  `vmbr_sandbox` — flagged in the file, needs confirming against Step 3.2).
- `app/proxmox_client.py` — proxmoxer wrapper: clone/start/stop/destroy,
  pool membership, uptime.
- `app/sessions.py` — in-memory session table (capacity cap, per-IP limit,
  token issuance). Not the reaper's source of truth by design.
- `app/ttyd_health.py` — Step 3.4's post-start ttyd reachability poll.
- `app/reaper.py` — Step 3.6 background safety net, checks the real pool
  on a timer independent of the session table.
- `app/ws_proxy.py` — Step 3.5 WebSocket relay between browser and ttyd.
- `app/main.py` — FastAPI app wiring the above into `POST /sessions` and
  `WS /ws/{session_id}`.
- `systemd/playground-controller.service` — Step 3.7 unit file.
- `.env.example` — required environment variables; copy to
  `/etc/playground-controller/controller.env` on the real host and fill in
  the token from Step 3.3.
- `requirements.txt` — fastapi, uvicorn, proxmoxer, requests, websockets.

## Running once the host is back

```
python3 -m venv venv
venv/bin/pip install -r requirements.txt
cp .env.example /etc/playground-controller/controller.env  # fill in real values
venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

This will fail immediately (by design — see `proxmox_client.py`) unless
`PROXMOX_HOST`, `PROXMOX_NODE`, `PROXMOX_TOKEN_ID`, and
`PROXMOX_TOKEN_SECRET` are all set to real values from Step 3.3.
