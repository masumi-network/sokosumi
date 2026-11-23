/**
 * OAuth scopes used by Sokosumi's Better Auth oauthProvider.
 *
 * - `openid` — OIDC identity only (ID token / userinfo)
 * - `sokosumi:api` — delegated Core `/v1` API access as the consenting user
 * - `offline_access` — refresh tokens (new access tokens without re-consent)
 * - `sokosumi:mcp` — calling Core's MCP server at `{origin}/mcp` (ADR 0076).
 *   Never grants `/v1`.
 */
export const OAUTH_SCOPE_OPENID = "openid";
export const OAUTH_SCOPE_CORE_API = "sokosumi:api";
export const OAUTH_SCOPE_OFFLINE_ACCESS = "offline_access";
export const OAUTH_SCOPE_MCP = "sokosumi:mcp";

/**
 * Scopes the OAuth provider offers web clients. CMO requests exactly this list
 * at sign-in, and Core rejects an authorize request that asks for a scope the
 * client is not allowed, so `sokosumi:mcp` stays out: Core adds it itself.
 */
export const OAUTH_PROVIDER_SCOPES = [
  OAUTH_SCOPE_OPENID,
  OAUTH_SCOPE_CORE_API,
  OAUTH_SCOPE_OFFLINE_ACCESS,
] as const;

export interface BuildOAuthClientScopeParamOptions {
  includeCoreApi: boolean;
  includeOfflineAccess: boolean;
}

/** Build the space-separated scope string for client registration / update. */
export function buildOAuthClientScopeParam(
  options: BuildOAuthClientScopeParamOptions,
): string {
  const scopes = [OAUTH_SCOPE_OPENID];
  if (options.includeCoreApi) {
    scopes.push(OAUTH_SCOPE_CORE_API);
  }
  if (options.includeOfflineAccess) {
    scopes.push(OAUTH_SCOPE_OFFLINE_ACCESS);
  }
  return scopes.join(" ");
}

export type OAuthClientGrantType = "authorization_code" | "refresh_token";

export function buildOAuthClientGrantTypes(
  includeOfflineAccess: boolean,
): OAuthClientGrantType[] {
  if (includeOfflineAccess) {
    return ["authorization_code", "refresh_token"];
  }
  return ["authorization_code"];
}

function normalizeOAuthScopes(
  scopes: readonly string[] | string | null | undefined,
): string[] {
  if (!scopes) {
    return [];
  }

  const entries = typeof scopes === "string" ? [scopes] : scopes;

  return entries.flatMap((entry) =>
    entry.split(/\s+/).filter((scope) => scope.length > 0),
  );
}

export function hasOAuthScope(
  scopes: readonly string[] | string | null | undefined,
  scope: string,
): boolean {
  return normalizeOAuthScopes(scopes).includes(scope);
}

export function hasCoreApiOAuthScope(
  scopes: readonly string[] | string | null | undefined,
): boolean {
  return hasOAuthScope(scopes, OAUTH_SCOPE_CORE_API);
}

export function hasOfflineAccessOAuthScope(
  scopes: readonly string[] | string | null | undefined,
): boolean {
  return hasOAuthScope(scopes, OAUTH_SCOPE_OFFLINE_ACCESS);
}
