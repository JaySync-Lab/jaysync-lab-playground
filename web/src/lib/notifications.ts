import { Redis } from "@upstash/redis";
import { checkHealth } from "@/lib/api";
import { sendEmail } from "@/lib/email";

// Redis.fromEnv() looks for UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN,
// but this project's Vercel KV integration only sets KV_REST_API_URL/
// KV_REST_API_TOKEN -- construct explicitly instead of keeping two copies
// of the same secret in sync.
const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// Step 4.5: KV keys. QUEUE_KEY is a Redis SET (automatic dedup) of emails
// collected during the *current* outage -- cleared entirely once a
// recovery email goes out, so a later, separate outage always starts
// from an empty list, never carrying over old signups.
const QUEUE_KEY = "outage:queue";
const LAST_STATE_KEY = "backend:last_state";

const FROM_ADDRESS = "JaySync-Lab Playground <ops@jaysynclab.com>";

export async function addToQueue(email: string): Promise<void> {
  await redis.sadd(QUEUE_KEY, email);
}

async function getQueue(): Promise<string[]> {
  return redis.smembers(QUEUE_KEY);
}

async function clearQueue(): Promise<void> {
  await redis.del(QUEUE_KEY);
}

async function setLastState(state: "up" | "down"): Promise<void> {
  await redis.set(LAST_STATE_KEY, state);
}

async function sendRecoveryEmail(to: string): Promise<void> {
  const text =
    "The JaySync-Lab playground is back online -- give it a try:\n\n" +
    "https://jslnode.jaysynclab.com\n\n" +
    "You're getting this because you signed up while it was down. " +
    "This list is cleared after every recovery, so you won't hear from " +
    "this address again unless you sign up during a future outage.";

  await sendEmail({
    to,
    from: FROM_ADDRESS,
    subject: "The playground is back",
    text,
    html: text.replace(/\n/g, "<br/>"),
  });
}

export interface HealthTransitionResult {
  healthy: boolean;
  transitioned: boolean;
  emailsSent: number;
}

/**
 * The one place both the push path (/api/host-online) and the Cron
 * fallback (/api/cron/health-check) funnel through. Never trusts a caller's
 * claim that the backend is up -- always does the real check itself.
 *
 * Sends whenever the real check passes AND the queue is non-empty --
 * *not* gated on an observed down->up transition via `last_state`. Found
 * this the hard way: `last_state` only changes when something actually
 * calls this function, but the push path only ever fires *after*
 * recovery (never during the outage itself), and Cron only runs once a
 * day (see the Hobby-plan note in the plan doc) -- so a short outage can
 * start and fully resolve without anything ever recording it as "down"
 * in between, leaving a real signup permanently unnotified even though
 * the queue correctly held their email the whole time. The queue itself
 * is the right signal: it's only ever non-empty because a real visitor's
 * health check genuinely failed at some point, and it's fully cleared
 * after every send, so per-outage isolation ("a later, separate outage
 * requires a fresh signup") holds without needing a separate state
 * marker at all. `last_state` is kept only as an informational record of
 * the last known status, not as a gate for whether to send.
 */
export async function checkAndNotifyIfRecovered(): Promise<HealthTransitionResult> {
  const { healthy } = await checkHealth();
  await setLastState(healthy ? "up" : "down");

  if (!healthy) {
    return { healthy: false, transitioned: false, emailsSent: 0 };
  }

  const queue = await getQueue();
  if (queue.length === 0) {
    return { healthy: true, transitioned: false, emailsSent: 0 };
  }

  let sent = 0;
  for (const email of queue) {
    try {
      await sendRecoveryEmail(email);
      sent++;
    } catch (err) {
      // One bad address must not stop the rest of the queue from being
      // notified -- log and continue, still clear the queue after.
      console.error("Failed to send recovery email:", err);
    }
  }
  await clearQueue();

  return { healthy: true, transitioned: true, emailsSent: sent };
}
