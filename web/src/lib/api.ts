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

// Health check for the offline/maintenance detection in Step 4.4 -- not
// wired into the UI yet, but the endpoint choice lives here so it's the
// one place to change later.
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/openapi.json`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export const SESSION_DURATION_SECONDS = 15 * 60;
