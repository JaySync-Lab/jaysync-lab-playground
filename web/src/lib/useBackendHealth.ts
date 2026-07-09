"use client";

import { useEffect, useState } from "react";
import { checkHealth } from "@/lib/api";

const POLL_INTERVAL_MS = 15_000;

/**
 * Step 4.4: polls the backend's health on load and periodically while
 * idle. `paused` should be true while a session is actively connected --
 * no point hammering health checks against a backend a WebSocket is
 * already proving is up, and it avoids any chance of the poll interfering
 * with an active session.
 */
export function useBackendHealth(paused: boolean): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    if (paused) return;

    let cancelled = false;

    const poll = async () => {
      const result = await checkHealth();
      if (!cancelled) setOnline(result);
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [paused]);

  return online;
}
