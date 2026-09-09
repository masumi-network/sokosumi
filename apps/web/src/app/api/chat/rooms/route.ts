import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { chatRoomService } from "@/lib/services/chat-room.service";

import { respondToBackgroundChatRead } from "../background-read";

/** Background sidebar collection reads (see `respondToBackgroundChatRead`). */
export async function GET(request: NextRequest) {
  const collection = request.nextUrl.searchParams.get("collection");
  if (
    collection !== "active" &&
    collection !== "archived" &&
    collection !== "invitations"
  ) {
    return NextResponse.json({ error: "Invalid collection" }, { status: 400 });
  }

  return respondToBackgroundChatRead("Chat rooms unavailable", async () => {
    if (collection === "invitations") {
      return { data: await chatRoomService.listPendingInvitations() };
    }
    const page = await (collection === "active"
      ? chatRoomService.listRooms()
      : chatRoomService.listArchivedRooms());
    return {
      data: page.rooms,
      pagination: { nextCursor: page.nextCursor, limit: page.rooms.length },
    };
  });
}
