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

  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const around = request.nextUrl.searchParams.get("around") ?? undefined;
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const limit = rawLimit == null ? undefined : Number(rawLimit);
  if (
    (cursor && around) ||
    (limit !== undefined &&
      (!Number.isInteger(limit) || limit < 1 || limit > 100))
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const options = { cursor, around, limit };
  return respondToBackgroundChatRead("Chat messages unavailable", async () => {
    const page = await (parentMessageId
      ? chatRoomService.listThreadMessages(roomId, parentMessageId, options)
      : chatRoomService.listMessages(roomId, options));
    return {
      data: page.messages,
      pagination: {
        nextCursor: page.nextCursor,
        limit: page.messages.length,
      },
    };
  });
}
