import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { chatSignalsService } from "@/lib/services/chat-signals.service";

import { respondToBackgroundChatRead } from "../../background-read";

/**
 * One room's written catch-up, read when the room opens. The model call can
 * take seconds, so it stays out of the server action queue that carries
 * marking the room read (see `respondToBackgroundChatRead`).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await context.params;
  if (!roomId) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  return respondToBackgroundChatRead("Summary unavailable", async () => ({
    data: await chatSignalsService.getSummary(roomId),
  }));
}
