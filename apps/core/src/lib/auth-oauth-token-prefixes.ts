/**
 * Prefixes Better Auth's OAuth provider stamps on the tokens it issues.
 *
 * Kept apart from `auth-oauth-provider.ts` so the auth middleware, which
 * every route loads, can recognise an OAuth access token without importing
 * the provider plugin.
 */
export const OAUTH_ACCESS_TOKEN_PREFIX = "soko_access_token_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "soko_refresh_token_";
