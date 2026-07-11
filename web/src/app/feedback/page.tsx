import { FeedbackForm } from "@/components/FeedbackForm";

export const metadata = {
  title: "Feedback — JaySync-Lab Playground",
  description: "Report a bug, suggest an idea, or let us know you want to contribute.",
};

export default function FeedbackPage() {
  return (
    <div className="scanline-overlay grid-bg relative flex min-h-screen flex-col items-center bg-background px-6 py-24 text-center text-foreground">
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
