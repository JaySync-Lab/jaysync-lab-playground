// Single source of truth for the backend origin -- never hardcode this
// elsewhere. Set via NEXT_PUBLIC_API_URL (see .env.example).
const API_URL = process.env.NEXT_PUBLIC_API_URL;

if (!API_URL) {
  // Fails loudly at build/runtime rather than silently calling a
  // relative path that would hit this frontend's own (nonexistent) API.
  throw new Error("NEXT_PUBLIC_API_URL is not set");
}

export interface SessionResponse {
  session_id: string;
  token: string;
  connect_info: { ws_path: string };
}

export class CapacityError extends Error {}
export class RateLimitError extends Error {}

export async function createSession(): Promise<SessionResponse> {
  const res = await fetch(`${API_URL}/sessions`, { method: "POST" });

  if (res.status === 503) {
    throw new CapacityError((await safeDetail(res)) ?? "playground unavailable");
  }
  if (res.status === 429) {
    throw new RateLimitError((await safeDetail(res)) ?? "you already have an active session");
  }
  if (!res.ok) {
    throw new Error((await safeDetail(res)) ?? `unexpected response (${res.status})`);
  }

  return res.json();
}

async function safeDetail(res: Response): Promise<string | null> {
  try {
    const body = await res.json();
    return typeof body?.detail === "string" ? body.detail : null;
  } catch {
    return null;
  }
}

export function wsUrl(wsPath: string, token: string): string {
  const httpUrl = new URL(API_URL!);
  const scheme = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${httpUrl.host}${wsPath}?token=${encodeURIComponent(token)}`;
}

export interface HealthCheckResult {
  healthy: boolean;
  activeSessions: number | null;
  maxSessions: number | null;
}

// Step 4.4: dedicated, cheap health check -- no Proxmox calls, no schema
// generation, just confirms the backend process is up and reachable
// through the tunnel. A hung request (host genuinely down) is treated
// the same as a network error via the timeout below, so this never
// leaves the caller waiting indefinitely.
//
// Also returns active/max session counts (round 2 of frontend fixes) --
// reuses this same poll for the "X of N sessions active" indicator
// rather than a second endpoint/poll loop. null when unavailable (health
// check failed, or an older backend without these fields).
export async function checkHealth(timeoutMs = 5000): Promise<HealthCheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return { healthy: false, activeSessions: null, maxSessions: null };
    const body = await res.json().catch(() => ({}));
    return {
      healthy: true,
      activeSessions: typeof body.active_sessions === "number" ? body.active_sessions : null,
      maxSessions: typeof body.max_sessions === "number" ? body.max_sessions : null,
    };
  } catch {
    return { healthy: false, activeSessions: null, maxSessions: null };
  } finally {
    clearTimeout(timer);
  }
}

export const SESSION_DURATION_SECONDS = 15 * 60;
