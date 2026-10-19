import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { coreClientNoRedirect } from "@/lib/clients/core.client";
import { respondToBackgroundChatRead } from "../../background-read";

/** Results for every rendered result message of one room, in one read. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await context.params;
  const messageIds =
    request.nextUrl.searchParams.get("messageIds")?.split(",") ?? [];
  if (!messageIds.some(Boolean)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  return respondToBackgroundChatRead("Results unavailable", async () => ({
    data: (
      await coreClientNoRedirect.getChatRoomMessageResultsBatch(
        roomId,
        messageIds,
      )
    ).data,
  }));
}
