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
import { useNodeStatus } from "@/lib/useNodeStatus";
import { OfflineState } from "@/components/OfflineState";
import { MobileCtrlToolbar } from "@/components/MobileCtrlToolbar";

function formatGiB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

type Phase = "idle" | "starting" | "connected" | "ended" | "error";

// ttyd's wire protocol (confirmed against the real backend during Phase 3
// testing): the client's first message is a JSON handshake sent as a TEXT
// frame; every message after that is a BINARY frame with a one-byte
// command prefix. '0' = INPUT (client->server) / OUTPUT (server->client).
const TTYD_INPUT = "0";
const TTYD_OUTPUT = 0x30; // '0' as a byte, for comparing the first byte of a Blob/ArrayBuffer
const TTYD_RESIZE = "1";

function sendResize(term: Terminal, ws: WebSocket | null) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const payload = new TextEncoder().encode(JSON.stringify({ columns: term.cols, rows: term.rows }));
  const framed = new Uint8Array(payload.length + 1);
  framed[0] = TTYD_RESIZE.charCodeAt(0);
  framed.set(payload, 1);
  ws.send(framed);
}

export function PlaygroundTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(SESSION_DURATION_SECONDS);

  // Part 4 item 9: sticky Ctrl modifier for the mobile toolbar (no
  // physical Ctrl key on a touch keyboard). Mirrored into a ref because
  // the custom key handler is attached once at terminal-mount time and
  // needs the current value without re-attaching on every toggle.
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const ctrlArmedRef = useRef(false);
  useEffect(() => {
    ctrlArmedRef.current = ctrlArmed;
  }, [ctrlArmed]);


  // Shared with both real typing (term.onData) and the on-screen toolbar
  // buttons, so both paths send input to ttyd identically.
  const sendRaw = useCallback((data: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload = new TextEncoder().encode(data);
    const framed = new Uint8Array(payload.length + 1);
    framed[0] = TTYD_INPUT.charCodeAt(0);
    framed.set(payload, 1);
    ws.send(framed);
  }, []);

  // Step 4.4: paused while a session is connected -- the open WebSocket is
  // already proof the backend is up, no need to poll on top of it.
  const { online, activeSessions, maxSessions } = useBackendHealth(phase === "connected");
  const nodeStatus = useNodeStatus();

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

    // Part 4 item 9: when Ctrl is armed via the mobile toolbar, intercept
    // the next keydown ourselves instead of letting xterm process it as
    // plain input. Mobile virtual keyboards have no physical Ctrl to hold,
    // so this is the only way to produce a real Ctrl+letter control byte
    // (e.g. Ctrl+X = 0x18) from a touch device. Returning false stops
    // xterm's default handling (and therefore onData) for this keystroke.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown" || !ctrlArmedRef.current) return true;
      if (event.key.length !== 1) return true; // ignore Shift/Backspace/etc.

      const code = event.key.toUpperCase().charCodeAt(0);
      if (code < 64 || code > 90) return true; // only A-Z map to a sane control byte

      event.preventDefault();
      sendRaw(String.fromCharCode(code - 64));
      setCtrlArmed(false);
      return false;
    });

    const onResize = () => {
      fitRef.current?.fit();
      if (termRef.current) sendResize(termRef.current, wsRef.current);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      term.dispose();
      termRef.current = null;
    };
    // sendRaw is stable (empty deps, only closes over a ref) -- safe to
    // omit without risking a stale closure, and adding it here would be
    // fine too but isn't needed for correctness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const endSession = useCallback((message: string) => {
    wsRef.current?.close();
    wsRef.current = null;
    setPhase("ended");
    setErrorMessage(message);
    // Don't leave Ctrl armed across a session boundary -- a stray keypress
    // at the start of the next session shouldn't silently get eaten as a
    // control byte.
    setCtrlArmed(false);
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
      sendRaw(data);
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
  }, [endSession, sendRaw]);

  const startSession = useCallback(async () => {
    setPhase("starting");
    setErrorMessage(null);
    setCtrlArmed(false);
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

  // The terminal container's own size changes (CSS class swap on phase
  // transition, see the active-session sizing below) don't fire a window
  // resize event, so FitAddon never notices on its own -- re-fit once the
  // CSS transition has had a moment to settle, then tell the remote ttyd
  // side about the new size (it doesn't know the container got bigger
  // otherwise).
  useEffect(() => {
    const id = setTimeout(() => {
      fitRef.current?.fit();
      if (termRef.current) sendResize(termRef.current, wsRef.current);
    }, 320);
    return () => clearTimeout(id);
  }, [phase]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const isFinalMinute = phase === "connected" && secondsLeft <= 60;

  // Only takes over the UI when no session is in flight -- if a session is
  // already starting/connected, an existing WebSocket failure handles that
  // gracefully on its own (endSession() -> "Connection lost."), rather than
  // yanking the terminal away mid-session the instant a health poll blips.
  const showOffline =
    online === false && (phase === "idle" || phase === "ended" || phase === "error");

  const isActive = phase === "connected";

  return (
    <div
      className={`flex w-full flex-col items-center gap-3 transition-[max-width] duration-300 ${
        isActive ? "max-w-7xl" : "max-w-5xl"
      }`}
    >
      {showOffline ? (
        <OfflineState />
      ) : (
        <>
          {isFinalMinute && (
            <div className="w-full animate-pulse rounded-md border border-danger/50 bg-danger/10 px-4 py-2 text-center font-mono text-sm font-semibold text-danger">
              ⚠ Session ending in {seconds}s — save anything you need now.
            </div>
          )}
          <div className="flex w-full items-center justify-between text-sm font-mono text-zinc-400">
            <span>
              {phase === "connected" && (
                <span className={isFinalMinute ? "font-bold text-danger" : "text-accent"}>
                  ● session active — {minutes}:{seconds.toString().padStart(2, "0")} remaining
                </span>
              )}
              {phase === "starting" && <span>connecting…</span>}
              {phase === "idle" && <span>no active session</span>}
              {phase === "ended" && (
                <span className="text-danger">{errorMessage ?? "session ended"}</span>
              )}
              {phase === "error" && <span className="text-danger">{errorMessage}</span>}
              {activeSessions !== null && maxSessions !== null && (
                <span className="ml-3 text-zinc-500">
                  · {activeSessions} of {maxSessions} sessions active
                </span>
              )}
              {nodeStatus !== null && (
                <span className="ml-3 text-zinc-500">
                  · host: {nodeStatus.cpuPercent.toFixed(0)}% CPU ·{" "}
                  {formatGiB(nodeStatus.memoryUsedBytes)}/{formatGiB(nodeStatus.memoryTotalBytes)} GiB
                  RAM
                </span>
              )}
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
          <p className="w-full text-xs font-mono text-zinc-400">
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
        className={`w-full rounded-lg border border-accent-dim/40 bg-surface p-3 shadow-[0_0_40px_-12px_rgba(78,227,168,0.25)] transition-[height] duration-300 ${
          isActive ? "h-[80dvh] min-h-[700px]" : "h-[620px]"
        } ${showOffline ? "hidden" : ""}`}
      />
      {/* The toolbar itself is position: fixed (see .touch-toolbar in
          globals.css) so it's always reachable without scrolling on a real
          phone -- this spacer just keeps it from visually overlapping the
          bottom of the page's own content once fixed. Only takes up space
          on the touch/coarse-pointer viewports the toolbar actually shows
          on. */}
      {!showOffline && (
        <>
          <div className="hidden [@media(pointer:coarse)]:block h-24 w-full shrink-0" />
          <MobileCtrlToolbar
            ctrlArmed={ctrlArmed}
            onToggleCtrl={() => setCtrlArmed((a) => !a)}
            onSend={sendRaw}
            disabled={phase !== "connected"}
          />
        </>
      )}
    </div>
  );
}
