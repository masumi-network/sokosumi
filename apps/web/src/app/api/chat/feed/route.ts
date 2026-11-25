import type { NextRequest } from "next/server";

import { chatFeedService } from "@/lib/services/chat-feed.service";

import { respondToBackgroundChatRead } from "../background-read";

/**
 * Background read of the reader's Feed. The sidebar Feed row reads one item
 * (`limit=1`) for the unread count; the Feed page reads its later pages here.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const cursor = params.get("cursor") ?? undefined;
  const limit = Number.parseInt(params.get("limit") ?? "", 10);

  return respondToBackgroundChatRead("Feed unavailable", async () => ({
    data: await chatFeedService.getPage({
      cursor,
      limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
    }),
  }));
}
