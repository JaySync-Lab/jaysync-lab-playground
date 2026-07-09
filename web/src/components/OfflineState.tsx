export function OfflineState() {
  return (
    <div className="flex w-full max-w-lg flex-col items-center gap-4 rounded-lg border border-border bg-surface p-8 text-center">
      <p className="font-mono text-xs tracking-[0.2em] text-danger">
        ● UNDER MAINTENANCE
      </p>
      <p className="text-sm text-zinc-400">
        The playground&apos;s backend is offline right now — usually a homelab
        restart or maintenance window. It comes back on its own.
      </p>
      {/* Step 4.5: email capture form goes here, submitting to a Vercel
          serverless function that queues the address in Vercel KV for a
          one-time recovery notification. Not built yet. */}
    </div>
  );
}
