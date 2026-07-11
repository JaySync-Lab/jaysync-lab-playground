import Link from "next/link";
import { FeedbackForm } from "@/components/FeedbackForm";

export const metadata = {
  title: "Feedback — JaySync-Lab Playground",
  description: "Report a bug, suggest an idea, or let us know you want to contribute.",
};

export default function FeedbackPage() {
  return (
    <div className="scanline-overlay grid-bg relative flex min-h-screen flex-col items-center overflow-hidden bg-background px-6 py-24 text-center text-foreground">
      <Link
        href="/"
        aria-label="Back to playground"
        className="absolute left-6 top-6 flex items-center gap-1.5 font-mono text-xs text-zinc-400 transition-colors hover:text-accent"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back
      </Link>
      <p className="font-mono text-xs tracking-[0.3em] text-accent">
        JAYSYNC-LAB // PLAYGROUND
      </p>
      <h1 className="glow-text mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
        Feedback
      </h1>
      <p className="mt-4 max-w-md font-mono text-sm text-zinc-400">
        Found a bug? Have an idea? Want to contribute? Let us know — this
        goes straight into the project&apos;s issue tracker.
      </p>
      <div className="mt-10 w-full max-w-lg">
        <FeedbackForm />
      </div>
    </div>
  );
}
