"use client";

import type { MouseEvent } from "react";

interface MobileCtrlToolbarProps {
  ctrlArmed: boolean;
  onToggleCtrl: () => void;
  onSend: (data: string) => void;
  disabled: boolean;
}

// Prevents a toolbar tap from stealing focus away from xterm.js's hidden
// input textarea. Without this, tapping any button blurs the terminal,
// which on a real touch device also dismisses the on-screen keyboard --
// exactly backwards for a toolbar whose entire point is staying in the
// typing flow (arm Ctrl, then immediately type the letter).
function preventFocusSteal(e: MouseEvent) {
  e.preventDefault();
}

// Part 4 item 9: mobile virtual keyboards have no physical Ctrl key, which
// makes Ctrl-chord-driven tools (nano, less, etc.) unusable on a touch
// device without this. "Ctrl" is a sticky modifier -- tapping it arms a
// flag that the next character typed on the OS keyboard gets intercepted
// and converted into the matching control byte (see the
// attachCustomKeyEventHandler wiring in PlaygroundTerminal). Esc/Tab/arrows
// are plain one-shot sends of the same escape sequences xterm.js would
// itself emit for a physical keypress in normal (non-application) cursor
// mode, which is this terminal's default.
export function MobileCtrlToolbar({
  ctrlArmed,
  onToggleCtrl,
  onSend,
  disabled,
}: MobileCtrlToolbarProps) {
  const keyClass =
    "flex-1 rounded-md border border-accent-dim/40 bg-surface py-2 font-mono text-sm text-zinc-300 transition-colors active:bg-accent/20 disabled:opacity-40";

  return (
    <div className="touch-toolbar w-full gap-1.5 border-t border-border bg-surface/80 p-2">
      <button
        type="button"
        disabled={disabled}
        onMouseDown={preventFocusSteal}
        onClick={onToggleCtrl}
        className={`${keyClass} ${ctrlArmed ? "border-accent bg-accent/20 text-accent" : ""}`}
      >
        Ctrl
      </button>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={preventFocusSteal}
        onClick={() => onSend("\x1b")}
        className={keyClass}
      >
        Esc
      </button>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={preventFocusSteal}
        onClick={() => onSend("\t")}
        className={keyClass}
      >
        Tab
      </button>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={preventFocusSteal}
        onClick={() => onSend("\x1b[D")}
        className={keyClass}
        aria-label="Left arrow"
      >
        ←
      </button>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={preventFocusSteal}
        onClick={() => onSend("\x1b[A")}
        className={keyClass}
        aria-label="Up arrow"
      >
        ↑
      </button>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={preventFocusSteal}
        onClick={() => onSend("\x1b[B")}
        className={keyClass}
        aria-label="Down arrow"
      >
        ↓
      </button>
      <button
        type="button"
        disabled={disabled}
        onMouseDown={preventFocusSteal}
        onClick={() => onSend("\x1b[C")}
        className={keyClass}
        aria-label="Right arrow"
      >
        →
      </button>
    </div>
  );
}
