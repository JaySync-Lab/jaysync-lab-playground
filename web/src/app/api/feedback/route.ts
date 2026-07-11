import { NextRequest, NextResponse } from "next/server";
import {
  FEEDBACK_TYPES,
  checkRateLimit,
  createFeedbackIssue,
  storeFeedbackEmail,
  type FeedbackType,
} from "@/lib/feedback";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE_LENGTH = 5000;

function getClientIp(req: NextRequest): string {
  // Vercel injects this for every request; the first entry is the real
  // client (subsequent entries are proxies further up the chain).
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { type, message, email, website } = body as {
    type?: unknown;
    message?: unknown;
    email?: unknown;
    website?: unknown; // honeypot
  };

  // Honeypot: real users never see or fill this field (CSS-hidden off
  // -screen). Responds with the exact same shape as a real success so a
  // bot gets no signal that it was silently dropped -- nothing is
  // created, no rate-limit slot is consumed.
  if (typeof website === "string" && website.trim() !== "") {
    return NextResponse.json({ status: "ok" });
  }

  if (typeof type !== "string" || !FEEDBACK_TYPES.includes(type as FeedbackType)) {
    return NextResponse.json({ error: "invalid feedback type" }, { status: 400 });
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "message is too long" }, { status: 400 });
  }

  let cleanEmail: string | null = null;
  if (typeof email === "string" && email.trim() !== "") {
    if (!EMAIL_RE.test(email.trim())) {
      return NextResponse.json({ error: "invalid email" }, { status: 400 });
    }
    cleanEmail = email.trim().toLowerCase();
  }

  const ip = getClientIp(req);
  const withinLimit = await checkRateLimit(ip);
  if (!withinLimit) {
    return NextResponse.json(
      { error: "too many submissions — try again later" },
      { status: 429 },
    );
  }

  let issueNumber: number;
  try {
    issueNumber = await createFeedbackIssue(type as FeedbackType, message);
  } catch (err) {
    console.error("Failed to create feedback issue:", err);
    return NextResponse.json({ error: "failed to submit feedback" }, { status: 502 });
  }

  if (cleanEmail) {
    // Best-effort: the issue is already filed at this point, so a KV
    // hiccup here must not surface as a failure to the submitter -- worst
    // case, that one submission just isn't reply-able.
    try {
      await storeFeedbackEmail(issueNumber, cleanEmail);
    } catch (err) {
      console.error(`Failed to store email for issue #${issueNumber}:`, err);
    }
  }

  return NextResponse.json({ status: "ok" });
}
