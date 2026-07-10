"use client";

import { useEffect, useState } from "react";
import { checkHealth } from "@/lib/api";

const POLL_INTERVAL_MS = 15_000;

export interface BackendHealthState {
  online: boolean | null;
  activeSessions: number | null;
  maxSessions: number | null;
}

/**
 * Step 4.4: polls the backend's health on load and periodically while
 * idle. `paused` should be true while a session is actively connected --
 * no point hammering health checks against a backend a WebSocket is
 * already proving is up, and it avoids any chance of the poll interfering
 * with an active session.
 *
 * Also surfaces active/max session counts (round 2 of frontend fixes),
 * piggybacking on this same poll for the "X of N sessions active"
 * indicator rather than a second poll loop.
 */
export function useBackendHealth(paused: boolean): BackendHealthState {
  const [state, setState] = useState<BackendHealthState>({
    online: null,
    activeSessions: null,
    maxSessions: null,
  });

  useEffect(() => {
    if (paused) return;

    let cancelled = false;

    const poll = async () => {
      const result = await checkHealth();
      if (!cancelled) {
        setState({
          online: result.healthy,
          activeSessions: result.activeSessions,
          maxSessions: result.maxSessions,
        });
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [paused]);

  return state;
}
