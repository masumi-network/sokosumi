import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { chatRoomService } from "@/lib/services/chat-room.service";
import { isUuidString } from "@/lib/utils/uuid";

import { respondToBackgroundChatRead } from "../background-read";

/**
 * Background sidebar reads (see `respondToBackgroundChatRead`): one collection,
 * or with `roomId` the one room a message event named. A room the reader can
 * no longer open answers null, so the caller reads the whole list.
 */
export async function GET(request: NextRequest) {
  const roomId = request.nextUrl.searchParams.get("roomId");
  if (roomId !== null) {
    if (!isUuidString(roomId)) {
      return NextResponse.json({ error: "Invalid room" }, { status: 400 });
    }
    return respondToBackgroundChatRead("Chat rooms unavailable", async () => ({
      data: await chatRoomService.getRoom(roomId),
    }));
  }

  const collection = request.nextUrl.searchParams.get("collection");
  if (
    collection !== "active" &&
    collection !== "archived" &&
    collection !== "elsewhere" &&
    collection !== "invitations"
  ) {
    return NextResponse.json({ error: "Invalid collection" }, { status: 400 });
  }

  return respondToBackgroundChatRead("Chat rooms unavailable", async () => {
    if (collection === "invitations") {
      return { data: await chatRoomService.listPendingInvitations() };
    }
    if (collection === "elsewhere") {
      return { data: await chatRoomService.listElsewhereRooms() };
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
