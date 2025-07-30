import { NextResponse } from "next/server";

import createAuthTokenRequest from "@/lib/ably/auth";
import { getSessionOrRedirect } from "@/lib/auth/utils";

export async function POST() {
  // check user is authenticated
  const session = await getSessionOrRedirect();

  const tokenRequest = await createAuthTokenRequest(session.user.id);
  return NextResponse.json(tokenRequest);
}
