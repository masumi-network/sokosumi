import { type NextRequest, NextResponse } from "next/server";

import createAuthTokenRequest from "@/lib/ably/auth";
import { getSession } from "@/lib/auth/auth.server";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const clientInstanceId =
      request.nextUrl.searchParams.get("clientInstanceId");
    const tokenRequest = await createAuthTokenRequest({ clientInstanceId });
    // Ably authUrl expects the raw TokenRequest body (not Core { data, meta }).
    return NextResponse.json(tokenRequest);
  } catch (error) {
    console.error("Failed to mint Ably token via Core:", error);
    return NextResponse.json(
      { error: "Failed to create Ably token" },
      { status: 502 },
    );
  }
}
