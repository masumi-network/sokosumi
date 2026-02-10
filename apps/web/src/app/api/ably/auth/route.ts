import { NextResponse } from "next/server";

import createAuthTokenRequest from "@/lib/ably/auth";
import { getSession } from "@/lib/auth/utils";

export const runtime = "edge";
export const preferredRegion = ["fra1", "dub1"]; // Frankfurt and Dublin

export async function POST() {
  // check user is authenticated
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokenRequest = await createAuthTokenRequest(session.user.id);
  return NextResponse.json(tokenRequest);
}
