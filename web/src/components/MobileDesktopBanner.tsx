"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "jsl-desktop-banner-dismissed";

// Touch/coarse-pointer devices only (same gating as the mobile Ctrl
// toolbar) -- a real terminal session is usable on a phone (the toolbar
// makes sure of that), but a physical keyboard is still a meaningfully
// better experience for a terminal-heavy site, so this sets expectations
// upfront rather than let a mobile visitor discover it mid-session.
// Persisted in localStorage (not sessionStorage) so dismissing it once
// keeps it dismissed on future visits, not just the current tab.
export function MobileDesktopBanner() {
  const [dismissed, setDismissed] = useState(true); // default hidden until confirmed not-dismissed, avoids a flash

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  if (dismissed) return null;

  return (
    <div className="touch-only-banner w-full border-b border-accent-dim/40 bg-accent/10 px-4 py-2 font-mono text-xs text-accent">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <span>For the best experience, use a computer.</span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, "1");
            setDismissed(true);
          }}
          className="shrink-0 rounded px-1.5 text-accent/70 transition-colors hover:bg-accent/20 hover:text-accent"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
