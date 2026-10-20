import { NextResponse } from "next/server";

import { coreClientNoRedirect } from "@/lib/clients/core.client";
import { readBotIdParam } from "@/lib/soko-bot/bot-id-param";
import { respondToBackgroundChatRead } from "../../../../chat/background-read";

/** One turn's result cards; `?botId=` reads a shared bot's turn. */
export async function GET(
  request: Request,
  context: { params: Promise<{ turnId: string }> },
) {
  const target = readBotIdParam(request.url);
  if (!target) {
    return NextResponse.json({ error: "Invalid bot id" }, { status: 400 });
  }
  const { turnId } = await context.params;
  return respondToBackgroundChatRead("Results unavailable", async () => ({
    data: (
      await coreClientNoRedirect.getMySokoBotTurnResults(turnId, target.botId)
    ).data,
  }));
}
