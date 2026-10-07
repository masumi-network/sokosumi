import "server-only";

import { NextResponse } from "next/server";

import { getServerCoreAppBaseUrl } from "@/lib/clients/utils/core-api-base-url";

export const CORE_OAUTH_AUTHORIZATION_SERVER_WELL_KNOWN_PATH =
  "/.well-known/oauth-authorization-server/auth";

export function redirectToCoreOAuthWellKnownResponse(): NextResponse {
  const coreBase = getServerCoreAppBaseUrl().replace(/\/$/, "");
  return NextResponse.redirect(
    `${coreBase}${CORE_OAUTH_AUTHORIZATION_SERVER_WELL_KNOWN_PATH}`,
    308,
  );
}
