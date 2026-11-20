import { NextResponse } from "next/server";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";
import { toChatTurnDetail } from "@/lib/soko-bot/chat-state";

export async function GET(
  _request: Request,
  context: { params: Promise<{ turnId: string }> },
) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable") {
    return coreSessionUnavailableJson("Turn unavailable", sessionRead);
  }
  if (sessionRead.status === "signedOut") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    assertAdminSession(sessionRead.session);
    const { turnId } = await context.params;
    const turn = await adminSokoBotService.getLabTurn(turnId);
    return NextResponse.json(
      { turn: toChatTurnDetail(turn) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isAdminAccessRequiredError(error)) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    const status =
      error instanceof CoreApiRequestError && error.status ? error.status : 502;
    return NextResponse.json({ error: "Turn unavailable" }, { status });
  }
}
