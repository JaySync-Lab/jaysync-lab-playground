"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  createSession,
  wsUrl,
  CapacityError,
  RateLimitError,
  SESSION_DURATION_SECONDS,
  type SessionResponse,
} from "@/lib/api";
import { useBackendHealth } from "@/lib/useBackendHealth";
import { OfflineState } from "@/components/OfflineState";

type Phase = "idle" | "starting" | "connected" | "ended" | "error";

// ttyd's wire protocol (confirmed against the real backend during Phase 3
// testing): the client's first message is a JSON handshake sent as a TEXT
// frame; every message after that is a BINARY frame with a one-byte
// command prefix. '0' = INPUT (client->server) / OUTPUT (server->client).
const TTYD_INPUT = "0";
const TTYD_OUTPUT = 0x30; // '0' as a byte, for comparing the first byte of a Blob/ArrayBuffer

export function PlaygroundTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(SESSION_DURATION_SECONDS);

  // Step 4.4: paused while a session is connected -- the open WebSocket is
  // already proof the backend is up, no need to poll on top of it.
  const online = useBackendHealth(phase === "connected");

  // Mount the xterm.js instance once, independent of session lifecycle,
  // so reconnecting doesn't tear down and rebuild the DOM terminal.
  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      convertEol: true,
      fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      fontSize: 14,
      theme: {
        background: "#0c0f11",
        foreground: "#e4e7eb",
        cursor: "#4ee3a8",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const onResize = () => fitRef.current?.fit();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      term.dispose();
      termRef.current = null;
    };
  }, []);

  const endSession = useCallback((message: string) => {
    wsRef.current?.close();
    wsRef.current = null;
    setPhase("ended");
    setErrorMessage(message);
  }, []);

  const connect = useCallback((session: SessionResponse) => {
    const term = termRef.current;
    if (!term) return;

    term.reset();
    const ws = new WebSocket(wsUrl(session.connect_info.ws_path, session.token));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      const cols = term.cols;
      const rows = term.rows;
      ws.send(JSON.stringify({ AuthToken: "", columns: cols, rows: rows }));
      setPhase("connected");
    };

    ws.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      if (bytes.length === 0 || bytes[0] !== TTYD_OUTPUT) return;
      term.write(bytes.subarray(1));
    };

    const onData = term.onData((data) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const payload = new TextEncoder().encode(data);
      const framed = new Uint8Array(payload.length + 1);
      framed[0] = TTYD_INPUT.charCodeAt(0);
      framed.set(payload, 1);
      ws.send(framed);
    });

    ws.onclose = () => {
      onData.dispose();
      if (wsRef.current === ws) {
        endSession("Session ended.");
      }
    };

    ws.onerror = () => {
      onData.dispose();
      endSession("Connection lost.");
    };
  }, [endSession]);

  const startSession = useCallback(async () => {
    setPhase("starting");
    setErrorMessage(null);
    try {
      const session = await createSession();
      setSecondsLeft(SESSION_DURATION_SECONDS);
      connect(session);
    } catch (err) {
      setPhase("error");
      if (err instanceof CapacityError) {
        setErrorMessage("Playground is at capacity — try again shortly.");
      } else if (err instanceof RateLimitError) {
        setErrorMessage("You already have an active session.");
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Failed to start session.");
      }
    }
  }, [connect]);

  // Countdown, purely client-side (the API doesn't return an expiry
  // timestamp yet) -- an approximation of the real server-side timeout,
  // not authoritative. The server closes the WebSocket regardless of
  // what this timer shows.
  useEffect(() => {
    if (phase !== "connected") return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  // Only takes over the UI when no session is in flight -- if a session is
  // already starting/connected, an existing WebSocket failure handles that
  // gracefully on its own (endSession() -> "Connection lost."), rather than
  // yanking the terminal away mid-session the instant a health poll blips.
  const showOffline =
    online === false && (phase === "idle" || phase === "ended" || phase === "error");

  return (
    <div className="flex w-full max-w-4xl flex-col items-center gap-3">
      {showOffline ? (
        <OfflineState />
      ) : (
        <>
          <div className="flex w-full items-center justify-between text-sm font-mono text-zinc-400">
            <span>
              {phase === "connected" && (
                <span className="text-accent">
                  ● session active — {minutes}:{seconds.toString().padStart(2, "0")} remaining
                </span>
              )}
              {phase === "starting" && <span>connecting…</span>}
              {phase === "idle" && <span>no active session</span>}
              {phase === "ended" && (
                <span className="text-danger">{errorMessage ?? "session ended"}</span>
              )}
              {phase === "error" && <span className="text-danger">{errorMessage}</span>}
            </span>
            {(phase === "idle" || phase === "ended" || phase === "error") && (
              <button
                onClick={startSession}
                className="rounded-md border border-accent-dim bg-accent/10 px-4 py-1.5 font-mono text-accent transition-colors hover:bg-accent/20"
              >
                {phase === "idle" ? "Start session" : "Start new session"}
              </button>
            )}
          </div>
          <p className="w-full text-xs font-mono text-zinc-500">
            Try <span className="text-zinc-300">tour</span> for a guided walkthrough,{" "}
            <span className="text-zinc-300">status</span> or{" "}
            <span className="text-zinc-300">neofetch</span> once connected. This is a
            real, isolated container — destroyed automatically when the session ends.
          </p>
        </>
      )}
      {/* Kept mounted (not unmounted on offline) so the xterm.js instance
          set up in the mount effect above always has a DOM home to attach
          to; hidden rather than removed. */}
      <div
        ref={containerRef}
        className={`h-[480px] w-full rounded-lg border border-border bg-surface p-3 ${
          showOffline ? "hidden" : ""
        }`}
      />
    </div>
  );
}
