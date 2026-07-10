import Link from "next/link";

export default function NotFound() {
  return (
    <div className="scanline-overlay grid-bg relative flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center text-foreground">
      <p className="materialize font-mono text-xs tracking-[0.3em] text-accent">
        JAYSYNC-LAB // PLAYGROUND
      </p>
      <h1 className="materialize materialize-delay-1 glow-text mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
        404: command not found
      </h1>
      <p className="materialize materialize-delay-2 mt-5 max-w-md font-mono text-sm text-zinc-400">
        <span className="text-danger">bash: {"{"}route{"}"}: </span>
        no such page in this session.
      </p>
      <p className="materialize materialize-delay-3 mt-6 font-mono text-xs text-zinc-400">
        root@playground:~$ cd{" "}
        <Link
          href="/"
          className="text-accent underline decoration-accent-dim underline-offset-4 hover:text-foreground"
        >
          ~
        </Link>
        <span className="cursor-blink text-accent">_</span>
      </p>
    </div>
  );
}
