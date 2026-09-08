import { type NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/auth.server";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { chatRoomService } from "@/lib/services/chat-room.service";

/** Background reads bypass the server action queue used by chat mutations. */
export async function GET(request: NextRequest) {
  const collection = request.nextUrl.searchParams.get("collection");
  if (
    collection !== "active" &&
    collection !== "archived" &&
    collection !== "invitations"
  ) {
    return NextResponse.json({ error: "Invalid collection" }, { status: 400 });
  }

  try {
    if (!(await getSession())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const meta = { timestamp: new Date(), requestId: crypto.randomUUID() };
    const headers = { "Cache-Control": "no-store" };
    if (collection === "invitations") {
      const data = await chatRoomService.listPendingInvitations();
      return NextResponse.json({ data, meta }, { headers });
    }

    const page = await (collection === "active"
      ? chatRoomService.listRooms()
      : chatRoomService.listArchivedRooms());
    return NextResponse.json(
      {
        data: page.rooms,
        meta: {
          ...meta,
          pagination: {
            cursor: null,
            nextCursor: page.nextCursor,
            limit: page.rooms.length,
          },
        },
      },
      { headers },
    );
  } catch (error) {
    // Core's server client may throw a sign-in redirect. A background read
    // must return a failed response, never sign-in HTML as successful data.
    const status =
      error instanceof CoreApiRequestError && error.status ? error.status : 502;
    return NextResponse.json({ error: "Chat rooms unavailable" }, { status });
  }
}
