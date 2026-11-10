import { type NextRequest, NextResponse } from "next/server";

import { requestDataRoomCode } from "@/lib/services/data-room-viewer.server";

/** Asks Core to email a sign-in code. Answers the same for every email. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
  } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) return NextResponse.json({ error: "email" }, { status: 400 });
  const result = await requestDataRoomCode(token, email);
  if (result === "sent") return NextResponse.json({ ok: true });
  return NextResponse.json(
    { error: result },
    { status: result === "closed" ? 410 : 404 },
  );
}
