import { cookies } from "next/headers";

import {
  DATA_ROOM_SESSION_COOKIE,
  proxyDataRoomBytes,
} from "@/lib/services/data-room-viewer.server";

/** The whole room as a zip, when the room allows downloads. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return proxyDataRoomBytes(
    `/share/rooms/${encodeURIComponent(token)}/zip`,
    (await cookies()).get(DATA_ROOM_SESSION_COOKIE)?.value,
  );
}
