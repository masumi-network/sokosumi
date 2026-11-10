import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import {
  DATA_ROOM_SESSION_COOKIE,
  proxyDataRoomBytes,
} from "@/lib/services/data-room-viewer.server";

/** One file of the room, through Core, which checks access and stamps it. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; resourceId: string }> },
) {
  const { token, resourceId } = await params;
  const download =
    request.nextUrl.searchParams.get("download") === "true"
      ? "?download=true"
      : "";
  return proxyDataRoomBytes(
    `/share/rooms/${encodeURIComponent(token)}/files/${encodeURIComponent(resourceId)}${download}`,
    (await cookies()).get(DATA_ROOM_SESSION_COOKIE)?.value,
  );
}
