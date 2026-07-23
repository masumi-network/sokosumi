/**
 * OAuth scopes used by Sokosumi's Better Auth oauthProvider.
 *
 * - `openid` — OIDC identity only (ID token / userinfo)
 * - `sokosumi:api` — delegated Core `/v1` API access as the consenting user
 */
export const OAUTH_SCOPE_OPENID = "openid";
export const OAUTH_SCOPE_CORE_API = "sokosumi:api";

/** Space-separated scope string for authorize/token/client registration. */
export const OAUTH_CORE_API_SCOPE_PARAM = `${OAUTH_SCOPE_OPENID} ${OAUTH_SCOPE_CORE_API}`;

export const OAUTH_PROVIDER_SCOPES = [
  OAUTH_SCOPE_OPENID,
  OAUTH_SCOPE_CORE_API,
] as const;

export function hasCoreApiOAuthScope(
  scopes: readonly string[] | null | undefined,
): boolean {
  return scopes?.includes(OAUTH_SCOPE_CORE_API) ?? false;
}
