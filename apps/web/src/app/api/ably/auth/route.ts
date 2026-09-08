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
    // Core authenticates the forwarded cookie. Only its 401 proves session loss.
    if (error instanceof CoreApiRequestError && error.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Failed to mint Ably token via Core:", error);
    return NextResponse.json(
      { error: "Failed to create Ably token" },
      { status: 502 },
    );
  }
}
