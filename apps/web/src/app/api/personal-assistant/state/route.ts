import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/auth.server";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";

/**
 * Chat-state poll used while a Soko Bot turn is running. A Route Handler
 * (not a server action) so background polling never contends with the
 * user's own server actions (send/accept), which Next serializes per session.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const state = await sokoBotService.getChatState();
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
