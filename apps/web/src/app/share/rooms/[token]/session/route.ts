import { type NextRequest, NextResponse } from "next/server";

import {
  DATA_ROOM_SESSION_COOKIE,
  DATA_ROOM_SESSION_MAX_AGE_SECONDS,
  dataRoomPath,
  signInToDataRoom,
} from "@/lib/services/data-room-viewer.server";

/** Trades an emailed code for an httpOnly cookie scoped to this room. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    code?: unknown;
  } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!email || !code)
    return NextResponse.json({ error: "wrong" }, { status: 400 });

  const result = await signInToDataRoom(token, email, code);
  if (!result.ok)
    return NextResponse.json(
      { error: result.reason },
      {
        status:
          result.reason === "wrong"
            ? 401
            : result.reason === "closed"
              ? 410
              : 404,
      },
    );

  const response = NextResponse.json({ ok: true });
  response.cookies.set(DATA_ROOM_SESSION_COOKIE, result.session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: dataRoomPath(token),
    maxAge: DATA_ROOM_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
