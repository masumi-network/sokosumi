import { NextResponse } from "next/server";

import createAuthTokenRequest from "@/lib/ably/auth";
import { getSessionOrThrow } from "@/lib/auth/utils";

export async function POST() {
  // check user is authenticated
  const session = await getSessionOrThrow();

  const tokenRequest = await createAuthTokenRequest(session.user.id);
  return NextResponse.json(tokenRequest);
}
