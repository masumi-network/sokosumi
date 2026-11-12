import { NextResponse } from "next/server";

import {
  DATA_ROOM_SESSION_COOKIE,
  dataRoomPath,
} from "@/lib/services/data-room-viewer.server";

/** Forgets this browser's room session. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const response = NextResponse.json({ ok: true });
  response.cookies.set(DATA_ROOM_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: dataRoomPath(token),
    maxAge: 0,
  });
  return response;
}
