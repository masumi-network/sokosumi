import { type NextRequest, NextResponse } from "next/server";

import {
  DRIVE_SHARE_UNLOCK_COOKIE,
  driveShareDownloadUrl,
} from "@/lib/services/drive-share.server";

/**
 * Sends the browser to the file, once the link and its password check out.
 * A refused file sends a click back to the link's page, and a Download all
 * fetch gets 404, so the page is never zipped in the file's place.
 */
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
    return request.headers.get("sec-fetch-mode") === "navigate"
      ? NextResponse.redirect(
          new URL(`/share/files/${encodeURIComponent(token)}`, request.url),
        )
      : new NextResponse(null, { status: 404 });
  return NextResponse.redirect(url);
}
