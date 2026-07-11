"use client";

import { useState, type FormEvent } from "react";

type FormStatus = "idle" | "submitting" | "done" | "error" | "rate-limited";

const FEEDBACK_TYPES = ["bug", "idea", "complaint", "want to contribute"] as const;

function labelFor(type: (typeof FEEDBACK_TYPES)[number]): string {
  return type[0].toUpperCase() + type.slice(1);
}

export function FeedbackForm() {
  const [type, setType] = useState<string>(FEEDBACK_TYPES[0]);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot -- real users never see this
  const [status, setStatus] = useState<FormStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, message, email: email || undefined, website }),
      });

      if (res.status === 429) {
        setStatus("rate-limited");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(typeof data.error === "string" ? data.error : "Something went wrong.");
        setStatus("error");
        return;
      }

      setStatus("done");
      setMessage("");
      setEmail("");
    } catch {
      setErrorMessage("Something went wrong — try again in a moment.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="flex w-full max-w-lg flex-col items-center gap-3 rounded-lg border border-border bg-surface p-8 text-center">
        <p className="font-mono text-sm text-accent">Thanks — got it.</p>
        <p className="text-xs text-zinc-400">
          Your feedback was filed. If you left an email, you might hear back.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-lg flex-col gap-4 rounded-lg border border-border bg-surface p-8"
    >
      {/* Honeypot: invisible to real users (off-screen, unreachable by tab,
          excluded from assistive tech) but present in the DOM for a bot's
          form-filler to find and populate. */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", top: "-9999px", height: 0, width: 0, overflow: "hidden" }}
      >
        <label htmlFor="website">Leave this field empty</label>
        <input
          type="text"
          id="website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="type" className="font-mono text-xs text-zinc-400">
          Type
        </label>
        <select
          id="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-md border border-border bg-black/40 px-3 py-2 font-mono text-sm text-foreground focus:border-accent-dim focus:outline-none"
        >
          {FEEDBACK_TYPES.map((t) => (
            <option key={t} value={t}>
              {labelFor(t)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="message" className="font-mono text-xs text-zinc-400">
          Message
        </label>
        <textarea
          id="message"
          required
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What's on your mind?"
          className="resize-none rounded-md border border-border bg-black/40 px-3 py-2 font-mono text-sm text-foreground placeholder:text-zinc-600 focus:border-accent-dim focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="font-mono text-xs text-zinc-400">
          Email <span className="text-zinc-600">(optional — only if you want a reply)</span>
        </label>
        <input
          type="email"
          id="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="rounded-md border border-border bg-black/40 px-3 py-2 font-mono text-sm text-foreground placeholder:text-zinc-600 focus:border-accent-dim focus:outline-none"
        />
      </div>

      <button
        type="submit"
        disabled={status === "submitting"}
        className="rounded-md border border-accent-dim bg-accent/10 px-4 py-2 font-mono text-sm text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
      >
        {status === "submitting" ? "Sending…" : "Send feedback"}
      </button>

      {status === "rate-limited" && (
        <p className="text-xs text-danger">
          Too many submissions from you recently — try again in a bit.
        </p>
      )}
      {status === "error" && errorMessage && (
        <p className="text-xs text-danger">{errorMessage}</p>
      )}
    </form>
  );
}
