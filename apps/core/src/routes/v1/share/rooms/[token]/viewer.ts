import type { Context } from "hono";

import { gone, notFound, unauthorized } from "@/helpers/error";
import { DATA_ROOM_SESSION_HEADER } from "@/schemas/data-room.schema";
import { resolveDataRoomViewer } from "@/services/data-room-access.service";

/** The signed-in viewer of a room, or the HTTP answer for why not. */
export async function requireDataRoomViewer(c: Context, token: string) {
  const viewer = await resolveDataRoomViewer({
    token,
    session: c.req.header(DATA_ROOM_SESSION_HEADER),
  });
  if (viewer.kind === "missing") throw notFound("Data room not found");
  if (viewer.kind === "closed")
    throw gone(
      viewer.reason === "expired"
        ? "This data room has expired."
        : "This data room is closed.",
    );
  if (viewer.kind === "out") throw unauthorized("Sign in to this data room");
  return viewer;
}
