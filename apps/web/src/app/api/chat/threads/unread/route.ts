import type { NextRequest } from "next/server";

import { chatRoomService } from "@/lib/services/chat-room.service";

import { respondToBackgroundChatRead } from "../../background-read";

/**
 * Background read of the reader's unread Threads across rooms (SOK-1159).
 * The Threads view reads again whenever a sidebar poll moves the rooms'
 * counts, so this stays out of the server action queue chat mutations use.
 */
export async function GET(request: NextRequest) {
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;

  return respondToBackgroundChatRead("Unread threads unavailable", async () => {
    const page = await chatRoomService.listUnreadThreads({ cursor });
    return {
      data: page.threads,
      pagination: { nextCursor: page.nextCursor, limit: page.threads.length },
    };
  });
}
