import { Redis } from "@upstash/redis";
import { sendEmail, renderEmailShell } from "@/lib/email";

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
      body: `**Type:** ${TYPE_TITLES[type]}\n\n**Message:**\n\n${message.trim()}\n\n---\n*Submitted via the feedback form on jslnode.jaysynclab.com.*`,
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

const FROM_ADDRESS = "JaySync-Lab Playground <ops@jaysynclab.com>";
const NOTIFY_EMAIL = process.env.FEEDBACK_NOTIFY_EMAIL;
const ISSUE_URL_BASE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Best-effort, non-fatal to the submission -- the issue is already the
// source of truth by the time this is called. Caller catches and logs.
export async function notifyOwnerOfFeedback(
  type: FeedbackType,
  message: string,
  email: string | null,
  issueNumber: number,
): Promise<void> {
  if (!NOTIFY_EMAIL) throw new Error("FEEDBACK_NOTIFY_EMAIL is not set");

  const issueUrl = `${ISSUE_URL_BASE}/${issueNumber}`;
  const trimmed = message.trim();
  const subjectSnippet = trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;

  const bodyHtml = `
    <p style="margin:0 0 16px;"><strong style="color:#e4e7eb;">${escapeHtml(TYPE_TITLES[type])}</strong> &middot; issue <a href="${issueUrl}" style="color:#4ee3a8;">#${issueNumber}</a></p>
    <p style="margin:0 0 16px;white-space:pre-wrap;background:#050607;border:1px solid #1c2228;border-radius:6px;padding:12px 14px;color:#e4e7eb;">${escapeHtml(trimmed)}</p>
    <p style="margin:0 0 6px;">Submitted by: ${email ? escapeHtml(email) : "<span style=\"color:#52525b;\">no email left</span>"}</p>
    <p style="margin:20px 0 0;">
      <a href="${issueUrl}" style="color:#4ee3a8;">View the issue on GitHub &rarr;</a>
      ${email ? `<br/><a href="mailto:${escapeHtml(email)}?subject=${encodeURIComponent("Re: your feedback on JaySync-Lab Playground")}" style="color:#4ee3a8;">Reply to ${escapeHtml(email)} &rarr;</a>` : ""}
    </p>`;

  await sendEmail({
    to: NOTIFY_EMAIL,
    from: FROM_ADDRESS,
    subject: `[Playground Feedback] ${TYPE_TITLES[type]}: ${subjectSnippet}`,
    html: renderEmailShell({ eyebrow: "New feedback", heading: TYPE_TITLES[type], bodyHtml }),
    text: `${TYPE_TITLES[type]} (issue #${issueNumber})\n\n${trimmed}\n\nSubmitted by: ${email ?? "no email left"}\n\n${issueUrl}`,
  });
}

// Only called when the submitter left an email. Content is genuinely
// specific to their submission (quotes their own message back, and the
// closing line varies by type) rather than one generic blanket template.
const TYPE_THANKS_CLOSING: Record<FeedbackType, string> = {
  bug: "I'll take a look — every bug report helps make the playground more solid.",
  idea: "I'll give it real thought for a future update.",
  complaint: "I appreciate you taking the time to tell me, honestly.",
  "want to contribute": `That's great to hear. Take a look at the repo any time, and feel free to open a PR or start a discussion: <a href="https://github.com/${REPO_OWNER}/${REPO_NAME}" style="color:#4ee3a8;">github.com/${REPO_OWNER}/${REPO_NAME}</a>`,
};

export async function sendThankYouEmail(
  type: FeedbackType,
  message: string,
  email: string,
): Promise<void> {
  const trimmed = message.trim();

  const bodyHtml = `
    <p style="margin:0 0 16px;">Thanks for sending this over:</p>
    <p style="margin:0 0 16px;white-space:pre-wrap;background:#050607;border:1px solid #1c2228;border-radius:6px;padding:12px 14px;color:#e4e7eb;">${escapeHtml(trimmed)}</p>
    <p style="margin:0 0 16px;">${TYPE_THANKS_CLOSING[type]}</p>
    <p style="margin:0;">&mdash; Anuja, JaySync-Lab</p>`;

  await sendEmail({
    to: email,
    from: FROM_ADDRESS,
    subject: "Thanks for your feedback — JaySync-Lab Playground",
    html: renderEmailShell({ eyebrow: "Got it", heading: "Thanks for the feedback", bodyHtml }),
    text: `Thanks for sending this over:\n\n${trimmed}\n\n${TYPE_THANKS_CLOSING[type].replace(/<[^>]+>/g, "")}\n\n— Anuja, JaySync-Lab`,
  });
}
