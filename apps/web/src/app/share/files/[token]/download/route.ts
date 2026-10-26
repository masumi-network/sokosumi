import { type NextRequest, NextResponse } from "next/server";

import {
  DRIVE_SHARE_UNLOCK_COOKIE,
  driveShareDownloadUrl,
} from "@/lib/services/drive-share.server";

/** Sends the browser to the file, once the link and its password check out. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const url = await driveShareDownloadUrl(
    token,
    request.cookies.get(DRIVE_SHARE_UNLOCK_COOKIE)?.value,
    request.nextUrl.searchParams.get("path") ?? undefined,
  );
  if (!url)
    return NextResponse.redirect(
      new URL(`/share/files/${encodeURIComponent(token)}`, request.url),
    );
  return NextResponse.redirect(url);
}
