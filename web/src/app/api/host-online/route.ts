import { NextRequest, NextResponse } from "next/server";
import { checkAndNotifyIfRecovered } from "@/lib/notifications";

const HOST_ONLINE_SECRET = process.env.HOST_ONLINE_SECRET;

// Step 4.5 point 4: the ping proves nothing by itself -- CT 105 claiming
// "I just started" doesn't mean the tunnel/service is actually reachable
// from the outside yet. A couple of short retries covers the race where
// the ping fires the instant the process starts, slightly ahead of the
// tunnel/DNS being fully ready.
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  if (!HOST_ONLINE_SECRET) {
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${HOST_ONLINE_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    const result = await checkAndNotifyIfRecovered();
    if (result.healthy) {
      return NextResponse.json(result);
    }
    if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }

  return NextResponse.json(
    { healthy: false, transitioned: false, emailsSent: 0, note: "gave up after retries" },
    { status: 200 }
  );
}
