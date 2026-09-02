import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/auth.server";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { sokoBotService } from "@/lib/services/soko-bot.service";

/**
 * Cheap activity probe for the console poller.
 *
 * The console watches turns it did not start, so it has to ask often enough
 * to catch one that only runs a few seconds. Asking for the whole chat state
 * that often is not affordable — that loads the bot plus twenty turns with
 * their events, delegations and decisions — so this carries just enough to
 * decide whether the full state is worth fetching.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const activity = await sokoBotService.getActivity();
    return NextResponse.json(
      { activity },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError && error.status ? error.status : 502;
    return NextResponse.json({ error: "Activity unavailable" }, { status });
  }
}
