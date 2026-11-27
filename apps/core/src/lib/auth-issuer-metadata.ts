import {
  metadataResponse,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { OAUTH_SCOPE_CORE_API } from "@sokosumi/utils";

import { auth } from "@/lib/auth.js";

/**
 * The issuer `{baseURL}/auth`'s RFC 8414 metadata. Core serves it under the
 * issuer and at the root `.well-known` path, so both read this one handler.
 *
 * MCP clients read it, and Codex registers and authorizes with its whole
 * `scopes_supported`. Open registration refuses `sokosumi:api` (ADR 0076), so
 * it is not listed here (RFC 8414 §2 lets a server leave scopes out). Clients
 * made on the developer page still ask for it, and CMO reads it from the
 * OpenID configuration, which keeps the full list.
 */
export async function handleOAuthAuthServerMetadata(
  request: Request,
): Promise<Response> {
  const metadata = await auth.api.getOAuthServerConfig({
    request,
    asResponse: false,
  });
  return metadataResponse({
    ...metadata,
    scopes_supported: metadata.scopes_supported?.filter(
      (scope) => scope !== OAUTH_SCOPE_CORE_API,
    ),
  });
}

export const handleOpenIdConfiguration =
  oauthProviderOpenIdConfigMetadata(auth);
