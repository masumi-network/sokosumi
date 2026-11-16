import { type NextRequest, NextResponse } from "next/server";

import {
  DRIVE_SHARE_UNLOCK_COOKIE,
  unlockDriveShare,
} from "@/lib/services/drive-share.server";

const UNLOCK_MAX_AGE_SECONDS = 12 * 60 * 60;

/** Trades the link's password for an httpOnly cookie scoped to this link. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = (await request.json().catch(() => null)) as {
    password?: unknown;
  } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) return NextResponse.json({ error: "wrong" }, { status: 400 });

  const result = await unlockDriveShare(token, password);
  if (!result.ok)
    return NextResponse.json(
      { error: result.reason },
      {
        status:
          result.reason === "locked"
            ? 429
            : result.reason === "wrong"
              ? 401
              : 404,
      },
    );

  const response = NextResponse.json({ ok: true });
  response.cookies.set(DRIVE_SHARE_UNLOCK_COOKIE, result.proof, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/share/files/${encodeURIComponent(token)}`,
    maxAge: UNLOCK_MAX_AGE_SECONDS,
  });
  return response;
}
