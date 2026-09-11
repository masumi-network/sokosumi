import { type NextRequest, NextResponse } from "next/server";

import createAuthTokenRequest from "@/lib/ably/auth";
import { CoreApiRequestError } from "@/lib/clients/core.request";

export async function POST(request: NextRequest) {
  try {
    const clientInstanceId =
      request.nextUrl.searchParams.get("clientInstanceId");
    const tokenRequest = await createAuthTokenRequest({ clientInstanceId });
    // Ably authUrl expects the raw TokenRequest body (not Core { data, meta }).
    return NextResponse.json(tokenRequest);
  } catch (error) {
    // Core authenticates the forwarded cookie. Only its 401 proves session
    // loss, and the browser ends the realtime client on repeated 401s, so
    // nothing else may borrow that status.
    if (error instanceof CoreApiRequestError && error.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Failed to mint Ably token via Core:", error);
    // Only a status Core actually answered with is a gateway error. A failure
    // carrying none never reached Core at all - the 7s budget expiring, a
    // reset connection, a DNS blip - and those clear on their own, so the
    // browser gets a retry hint rather than a flat 502. `core.request.ts`
    // wraps a transport failure in a status-less `CoreApiRequestError`, and
    // `api/chat/background-read.ts` reads it the same way.
    if (!(error instanceof CoreApiRequestError) || !error.status) {
      const reason =
        error instanceof Error && error.name === "TimeoutError"
          ? "timeout"
          : "transport";
      return NextResponse.json(
        { error: "Ably token unavailable", reason },
        { status: 503, headers: { "Retry-After": "1" } },
      );
    }
    return NextResponse.json(
      { error: "Failed to create Ably token" },
      { status: 502 },
    );
  }
}
