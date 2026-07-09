import { NextRequest, NextResponse } from "next/server";
import { addToQueue } from "@/lib/notifications";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const email = (body as { email?: unknown })?.email;
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  await addToQueue(email.trim().toLowerCase());

  return NextResponse.json({ status: "queued" });
}
