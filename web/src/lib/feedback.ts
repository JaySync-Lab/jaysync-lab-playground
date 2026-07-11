import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export const FEEDBACK_TYPES = ["bug", "idea", "complaint", "want to contribute"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

// One label per type, created on the repo ahead of time (bug already
// existed; feature-request/feedback/contribution-interest were added
// alongside this feature).
const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "bug",
  idea: "feature-request",
  complaint: "feedback",
  "want to contribute": "contribution-interest",
};

const TYPE_TITLES: Record<FeedbackType, string> = {
  bug: "Bug",
  idea: "Idea",
  complaint: "Complaint",
  "want to contribute": "Contribution interest",
};

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hour

// Fixed window per IP: INCR is atomic, and EXPIRE only gets (re-)armed on
// the first hit of a fresh window (count === 1) so a burst of requests
// can't keep pushing the window back indefinitely.
export async function checkRateLimit(ip: string): Promise<boolean> {
  const key = `feedback:ratelimit:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  }
  return count <= RATE_LIMIT_MAX;
}

function buildTitle(type: FeedbackType, message: string): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  const snippet = trimmed.slice(0, 70);
  const truncated = trimmed.length > 70;
  return `[${TYPE_TITLES[type]}] ${snippet}${truncated ? "…" : ""}`;
}

const GITHUB_TOKEN = process.env.GITHUB_FEEDBACK_TOKEN;
const REPO_OWNER = "JaySync-Lab";
const REPO_NAME = "jaysync-lab-playground";

// Creates the issue with ONLY the type and message in the body -- the
// caller must never pass email through here. Returns the created issue
// number so the caller can key a private KV record to it.
export async function createFeedbackIssue(type: FeedbackType, message: string): Promise<number> {
  if (!GITHUB_TOKEN) throw new Error("GITHUB_FEEDBACK_TOKEN is not set");

  const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: buildTitle(type, message),
      body: `**Type:** ${TYPE_TITLES[type]}\n\n**Message:**\n\n${message.trim()}\n\n---\n*Submitted via the feedback form on jslnode.anujajay.com.*`,
      labels: [TYPE_LABELS[type]],
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub issue creation failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { number: number };
  return data.number;
}

// Private -- never surfaced on the public issue. Only reachable by
// looking up this exact key (issue number), not enumerable.
export async function storeFeedbackEmail(issueNumber: number, email: string): Promise<void> {
  await redis.set(`feedback:email:${issueNumber}`, email);
}

export async function getFeedbackEmail(issueNumber: number): Promise<string | null> {
  return redis.get(`feedback:email:${issueNumber}`);
}
