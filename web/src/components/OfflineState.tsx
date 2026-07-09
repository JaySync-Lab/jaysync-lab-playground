"use client";

import { useState, type FormEvent } from "react";

type FormStatus = "idle" | "submitting" | "done" | "error";

export function OfflineState() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setStatus(res.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex w-full max-w-lg flex-col items-center gap-4 rounded-lg border border-border bg-surface p-8 text-center">
      <p className="font-mono text-xs tracking-[0.2em] text-danger">
        ● UNDER MAINTENANCE
      </p>
      <p className="text-sm text-zinc-400">
        The playground&apos;s backend is offline right now — usually a homelab
        restart or maintenance window. It comes back on its own.
      </p>

      {status === "done" ? (
        <p className="font-mono text-sm text-accent">
          Got it — we&apos;ll email you the moment it&apos;s back.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex w-full max-w-xs gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="min-w-0 flex-1 rounded-md border border-border bg-black/40 px-3 py-2 font-mono text-sm text-foreground placeholder:text-zinc-600 focus:border-accent-dim focus:outline-none"
          />
          <button
            type="submit"
            disabled={status === "submitting"}
            className="whitespace-nowrap rounded-md border border-accent-dim bg-accent/10 px-3 py-2 font-mono text-sm text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
          >
            {status === "submitting" ? "…" : "Notify me"}
          </button>
        </form>
      )}
      {status === "error" && (
        <p className="text-xs text-danger">Something went wrong — try again in a moment.</p>
      )}
    </div>
  );
}
