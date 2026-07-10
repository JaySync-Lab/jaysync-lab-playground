"use client";

import { useEffect, useState } from "react";
import { fetchNodeStatus, type NodeStatus } from "@/lib/api";

const POLL_INTERVAL_MS = 15_000;

/**
 * Part 4: polls the real Proxmox host CPU/RAM for the live hardware stats
 * display. Not paused during an active session -- unlike useBackendHealth,
 * this isn't a redundant liveness check riding alongside an open
 * WebSocket, it's the actual content being displayed, so it keeps polling
 * throughout.
 */
export function useNodeStatus(): NodeStatus | null {
  const [status, setStatus] = useState<NodeStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const result = await fetchNodeStatus();
      if (!cancelled && result !== null) {
        setStatus(result);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return status;
}
