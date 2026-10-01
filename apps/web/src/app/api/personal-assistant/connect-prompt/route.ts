import { NextResponse } from "next/server";

import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";

/**
 * Whether the owner's bot still lacks mail or calendar, for the chat's
 * connect prompt. A Route Handler (not a server action) because the chat
 * reads it on mount, and a mount read must not queue behind the user's sends.
 */
export async function GET() {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable") {
    return coreSessionUnavailableJson("Prompt unavailable", sessionRead);
  }
  if (sessionRead.status === "signedOut") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const prompt = await sokoBotService.getConnectPromptState();
    return NextResponse.json(
      { prompt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError && error.status ? error.status : 502;
    return NextResponse.json({ error: "Prompt unavailable" }, { status });
  }
}
