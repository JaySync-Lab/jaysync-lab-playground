import { PlaygroundTerminal } from "@/components/PlaygroundTerminal";

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col items-center bg-background text-foreground">
      <section className="scanline-overlay grid-bg relative flex w-full flex-col items-center justify-center overflow-hidden px-6 pb-16 pt-24 text-center">
        <p className="font-mono text-xs tracking-[0.3em] text-accent">
          JAYSYNC-LAB // PLAYGROUND
        </p>
        <h1 className="glow-text mt-4 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          A real Linux box.
          <br />
          Disposable on purpose.
        </h1>
        <p className="mt-5 max-w-md font-mono text-sm text-zinc-400">
          Clone, connect, explore. Isolated container, auto-destroyed on exit —
          no signup, no simulation.
        </p>
      </section>

      <main className="flex w-full flex-1 flex-col items-center px-6 pb-24">
        <PlaygroundTerminal />
      </main>

      <footer className="w-full border-t border-border px-6 py-8 text-center font-mono text-xs text-zinc-500">
        <p>
          Built on a homelab running{" "}
          <a
            href="https://lab.anujajay.com"
            className="text-zinc-300 underline decoration-accent-dim underline-offset-4 hover:text-accent"
          >
            JaySync-Lab
          </a>
          . Source on{" "}
          <a
            href="https://github.com/JaySync-Lab/jaysync-lab-playground"
            className="text-zinc-300 underline decoration-accent-dim underline-offset-4 hover:text-accent"
          >
            GitHub
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
