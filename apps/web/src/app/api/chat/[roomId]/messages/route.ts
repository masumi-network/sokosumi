import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { chatRoomService } from "@/lib/services/chat-room.service";

import { respondToBackgroundChatRead } from "../../background-read";

/** Background room and thread reads (see `respondToBackgroundChatRead`). */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await context.params;
  const parentMessageId = request.nextUrl.searchParams.get("parentMessageId");
  if (!roomId || parentMessageId === "") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  return respondToBackgroundChatRead("Chat messages unavailable", async () => {
    const page = await (parentMessageId
      ? chatRoomService.listThreadMessages(roomId, parentMessageId)
      : chatRoomService.listMessages(roomId));
    return {
      data: page.messages,
      pagination: {
        nextCursor: page.nextCursor,
        limit: page.messages.length,
      },
    };
  });
}
