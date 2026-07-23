/**
 * OAuth scopes used by Sokosumi's Better Auth oauthProvider.
 *
 * - `openid` — OIDC identity only (ID token / userinfo)
 * - `sokosumi:api` — delegated Core `/v1` API access as the consenting user
 */
export const OAUTH_SCOPE_OPENID = "openid";
export const OAUTH_SCOPE_CORE_API = "sokosumi:api";

/** Space-separated scope string when Core API access is requested. */
export const OAUTH_CORE_API_SCOPE_PARAM = `${OAUTH_SCOPE_OPENID} ${OAUTH_SCOPE_CORE_API}`;

/** Scopes advertised by the OAuth provider (authorization server). */
export const OAUTH_PROVIDER_SCOPES = [
  OAUTH_SCOPE_OPENID,
  OAUTH_SCOPE_CORE_API,
] as const;

/**
 * Default scopes for new OAuth client registration.
 * Identity-only; developers opt in to `sokosumi:api` at create time.
 */
export const OAUTH_CLIENT_REGISTRATION_DEFAULT_SCOPES = [
  OAUTH_SCOPE_OPENID,
] as const;

/** Build the space-separated scope string for client registration / update. */
export function buildOAuthClientScopeParam(includeCoreApi: boolean): string {
  return includeCoreApi ? OAUTH_CORE_API_SCOPE_PARAM : OAUTH_SCOPE_OPENID;
}

function normalizeOAuthScopes(
  scopes: readonly string[] | string | null | undefined,
): string[] {
  if (!scopes) {
    return [];
  }

  if (typeof scopes === "string") {
    return scopes.split(/\s+/).filter((scope) => scope.length > 0);
  }

  return [...scopes];
}

export function hasCoreApiOAuthScope(
  scopes: readonly string[] | string | null | undefined,
): boolean {
  return normalizeOAuthScopes(scopes).includes(OAUTH_SCOPE_CORE_API);
}
