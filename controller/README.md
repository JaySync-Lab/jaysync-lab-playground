# Playground Session Controller

Implements Steps 3.2-3.8 of `../playground-phase3-session-controller-plan.md`
in full, including Step 3.1's decommission of the old CT 105.

## Status: Tested against the real host

Every scenario in Step 3.8's end-to-end test plan has passed against the
real Proxmox host, a real ttyd instance, and a real WebSocket client — see
`../implementation-log.md` (Phase 3) for the full write-up, including three
real bugs found and fixed during that testing (a `ws_proxy.py` handshake
crash, a `ws_proxy.py` disconnect-hang, and a `nesting=1` regression in the
golden template). See each file's own docstring for what was specifically
verified there.

## Layout

- `app/config.py` — env-driven configuration. The `vmbr_sandbox` static-IP
  scheme is confirmed correct against the real network; session duration
  and ttyd healthcheck timeout are proven to work but still the original
  placeholder values, not re-tuned against measured worst-case timing.
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

## Running

```
python3 -m venv venv
venv/bin/pip install -r requirements.txt
cp .env.example /etc/playground-controller/controller.env  # fill in real values
venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

This will fail immediately (by design — see `proxmox_client.py`) unless
`PROXMOX_HOST`, `PROXMOX_NODE`, `PROXMOX_TOKEN_ID`, and
`PROXMOX_TOKEN_SECRET` are all set to real values from Step 3.3. In
production this runs as the `playground-controller` systemd service on
CT 105, not via a manually-run `uvicorn` process — see
`systemd/playground-controller.service`.
