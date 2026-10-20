import { NextResponse } from "next/server";

import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { readBotIdParam } from "@/lib/soko-bot/bot-id-param";

/**
 * Chat-state poll used while a Soko Bot turn is running. A Route Handler
 * (not a server action) so background polling never contends with the
 * user's own server actions (send/accept), which Next serializes per session.
 * `?botId=` reads a shared bot instead of the caller's own.
 */
export async function GET(request: Request) {
  const target = readBotIdParam(request.url);
  if (!target) {
    return NextResponse.json({ error: "Invalid bot id" }, { status: 400 });
  }
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable") {
    return coreSessionUnavailableJson("State unavailable", sessionRead);
  }
  if (sessionRead.status === "signedOut") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const state = await sokoBotService.getChatState(target.botId);
    return NextResponse.json(
      { state },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError && error.status ? error.status : 502;
    return NextResponse.json({ error: "State unavailable" }, { status });
  }
}
