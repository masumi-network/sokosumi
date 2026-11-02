import { NextResponse } from "next/server";

import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { readBotIdParam } from "@/lib/soko-bot/bot-id-param";

/**
 * Avatar studio poll while a kept look renders its states. A Route Handler
 * (not a server action) for the same reason as the state poll: it must never
 * queue behind the owner's own actions. `?botId=` reads a shared bot.
 */
export async function GET(request: Request) {
  const target = readBotIdParam(request.url);
  if (!target) {
    return NextResponse.json({ error: "Invalid bot id" }, { status: 400 });
  }
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable") {
    return coreSessionUnavailableJson("Avatar unavailable", sessionRead);
  }
  if (sessionRead.status === "signedOut") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const studio = await sokoBotService.getAvatarStudio(target.botId);
    return NextResponse.json(
      { studio },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError && error.status ? error.status : 502;
    return NextResponse.json({ error: "Avatar unavailable" }, { status });
  }
}
