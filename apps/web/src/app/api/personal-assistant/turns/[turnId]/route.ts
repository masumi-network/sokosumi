import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/auth.server";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { toChatTurnDetail } from "@/lib/soko-bot/chat-state";

/** Full detail for one turn, loaded on demand by the "Explain" disclosure. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ turnId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { turnId } = await context.params;
  try {
    const turn = await sokoBotService.getTurn(turnId);
    return NextResponse.json(
      { turn: toChatTurnDetail(turn) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError && error.status ? error.status : 502;
    return NextResponse.json({ error: "Turn unavailable" }, { status });
  }
}
