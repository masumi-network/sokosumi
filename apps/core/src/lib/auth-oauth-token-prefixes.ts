import { createHash } from "node:crypto";

/**
 * Prefixes Better Auth's OAuth provider stamps on the tokens it issues, and
 * how it stores those tokens.
 *
 * Kept apart from `auth-oauth-provider.ts` so the auth middleware, which
 * every route loads, can look up an OAuth access token without importing the
 * provider plugin.
 */
export const OAUTH_ACCESS_TOKEN_PREFIX = "soko_access_token_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "soko_refresh_token_";

/**
 * The token as Better Auth stores it (its default `storeTokens: "hashed"`):
 * a SHA-256 base64url digest of the token without its prefix.
 */
export function hashStoredOAuthToken(token: string, prefix: string): string {
  return createHash("sha256")
    .update(token.startsWith(prefix) ? token.slice(prefix.length) : token)
    .digest("base64url");
}
