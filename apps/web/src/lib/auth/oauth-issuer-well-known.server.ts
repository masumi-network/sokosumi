import "server-only";

import { getServerCoreAppBaseUrl } from "@/lib/clients/utils/core-api-base-url";

export const CORE_OAUTH_AUTHORIZATION_SERVER_WELL_KNOWN_PATH =
  "/.well-known/oauth-authorization-server/auth";

export function getCoreOAuthAuthorizationServerWellKnownUrl(): string {
  const coreBase = getServerCoreAppBaseUrl().replace(/\/$/, "");
  return `${coreBase}${CORE_OAUTH_AUTHORIZATION_SERVER_WELL_KNOWN_PATH}`;
}
