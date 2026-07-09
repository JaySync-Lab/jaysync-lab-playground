import { NextRequest, NextResponse } from "next/server";
import { checkAndNotifyIfRecovered } from "@/lib/notifications";

// Step 4.5 point 6: the fallback safety net. The plan called for hourly,
// but Vercel's Hobby plan only allows daily Cron schedules -- this runs
// once a day (see vercel.json) as the maximum available on the current
// plan, not a deliberate design choice. Catches the edge case where the
// push ping never reaches Vercel at all (host network up before DNS/
// tunnel is, or the ping script itself fails). Funnels through the exact
// same checkAndNotifyIfRecovered() as the push path, so a "still up"
// check on either path never sends email -- only a genuine down->up
// transition does.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await checkAndNotifyIfRecovered();
  return NextResponse.json(result);
}
