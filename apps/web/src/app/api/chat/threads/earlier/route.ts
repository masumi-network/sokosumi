import type { NextRequest } from "next/server";

import { chatRoomService } from "@/lib/services/chat-room.service";

import { respondToBackgroundChatRead } from "../../background-read";

/**
 * Background read of the reader's read Threads across rooms: the Threads
 * view's Earlier group (SOK-1159). Outside the server action queue, as the
 * unread read is, since the same room poll drives both.
 */
export async function GET(request: NextRequest) {
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;

  return respondToBackgroundChatRead(
    "Earlier threads unavailable",
    async () => {
      const page = await chatRoomService.listEarlierThreads({ cursor });
      return {
        data: page.threads,
        pagination: { nextCursor: page.nextCursor, limit: page.threads.length },
      };
    },
  );
}
