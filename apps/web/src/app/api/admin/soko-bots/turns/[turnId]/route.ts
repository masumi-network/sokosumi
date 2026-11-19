import { NextResponse } from "next/server";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";
import { toChatTurnDetail } from "@/lib/soko-bot/chat-state";

export async function GET(
  _request: Request,
  context: { params: Promise<{ turnId: string }> },
) {
  const { turnId } = await context.params;
  try {
    const turn = await adminSokoBotService.getLabTurn(turnId);
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
