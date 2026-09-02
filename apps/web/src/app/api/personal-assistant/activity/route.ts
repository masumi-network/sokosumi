import { NextResponse } from "next/server";

import {
  CoreApiRequestError,
  coreClientNoRedirect,
} from "@/lib/clients/core.client";

/**
 * Cheap activity probe for the console poller.
 *
 * The console watches turns it did not start, so it has to ask often enough
 * to catch one that only runs a few seconds. Asking for the whole chat state
 * that often is not affordable — that loads the bot plus twenty turns with
 * their events, delegations and decisions — so this carries just enough to
 * decide whether the full state is worth fetching.
 *
 * No session preflight, unlike the state route beside it: Core authenticates
 * this call itself and answers 401, and on a path polled this often a second
 * round trip to check first is the more expensive half of the request. The
 * non-redirecting client is what makes that work — the redirecting one turns
 * Core's 401 into a thrown Next redirect that would surface here as a 502.
 */
export async function GET() {
  try {
    const { data: activity } =
      await coreClientNoRedirect.getMySokoBotActivity();
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
