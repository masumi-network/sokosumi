import type { OAuthResourceInput } from "@better-auth/oauth-provider";
import {
  OAUTH_SCOPE_MCP,
  OAUTH_SCOPE_OFFLINE_ACCESS,
  OAUTH_SCOPE_OPENID,
} from "@sokosumi/utils";

/**
 * Core's MCP server as an OAuth protected resource (ADR 0076). Kept free of
 * `@/lib/auth` so the provider config can import it.
 */

const MCP_RESOURCE_NAME = "Sokosumi MCP";

/** 15 minutes. A JWT cannot be revoked, so it is short-lived (ADR 0076). */
const MCP_ACCESS_TOKEN_TTL_SECONDS = 900;

/**
 * The RFC 8707 resource identifier and the `aud` of every MCP token:
 * `{Core origin}/mcp`, without a trailing slash. Takes any URL on Core's
 * origin, such as the public base URL or the issuer `{origin}/auth`.
 */
export function mcpResourceIdentifier(coreUrl: string): string {
  return new URL("/mcp", coreUrl).href;
}

/** The `oauthProvider({ resources })` entry, seeded into `oauthResource`. */
export function mcpOAuthResource(coreUrl: string): OAuthResourceInput {
  return {
    identifier: mcpResourceIdentifier(coreUrl),
    name: MCP_RESOURCE_NAME,
    accessTokenTtl: MCP_ACCESS_TOKEN_TTL_SECONDS,
    // A token for this resource carries only these, so a request that also
    // asks for `sokosumi:api` gets an MCP token without it. `openid` stays so
    // the client still gets its ID token.
    allowedScopes: [
      OAUTH_SCOPE_OPENID,
      OAUTH_SCOPE_MCP,
      OAUTH_SCOPE_OFFLINE_ACCESS,
    ],
  };
}

/** RFC 9728 protected-resource metadata for the MCP server. */
export function mcpProtectedResourceMetadata(issuer: string) {
  return {
    resource: mcpResourceIdentifier(issuer),
    resource_name: MCP_RESOURCE_NAME,
    authorization_servers: [issuer],
    scopes_supported: [OAUTH_SCOPE_MCP, OAUTH_SCOPE_OFFLINE_ACCESS],
    bearer_methods_supported: ["header"],
  };
}
