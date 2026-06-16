import { NextResponse } from "next/server";

import { getCoreOAuthAuthorizationServerWellKnownUrl } from "@/lib/auth/oauth-issuer-well-known.server";

export async function GET() {
  return NextResponse.redirect(
    getCoreOAuthAuthorizationServerWellKnownUrl(),
    308,
  );
}
