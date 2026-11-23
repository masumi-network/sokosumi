import { hasOAuthScope } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

import { type ActiveUserCandidate, isActiveUser } from "./auth-active-user";

/** Columns of `OauthClient` that {@link checkOAuthGrant} reads. */
export const OAUTH_GRANT_CLIENT_SELECT = {
  disabled: true,
  scopes: true,
  skipConsent: true,
} as const;

export interface OAuthGrant<User extends ActiveUserCandidate> {
  userId: string;
  clientId: string;
  /** The scopes on the presented access token. */
  tokenScopes: readonly string[] | string;
  /** Loaded with `BEARER_USER_SELECT`. */
  user: User | null;
  /** Loaded with {@link OAUTH_GRANT_CLIENT_SELECT}. */
  client: {
    disabled: boolean | null;
    scopes: string[];
    skipConsent: boolean | null;
  } | null;
}

/**
 * `insufficient_scope` means the token is good but `requiredScope` is missing
 * from the token, the client's allow-list, or the user's consent; the caller
 * answers 403 so the client knows to reauthorize, not to sign in again.
 */
export type OAuthGrantStatus = "active" | "inactive" | "insufficient_scope";

/**
 * The grant checks every OAuth access token passes on every request, whatever
 * its format: an opaque token at `/v1` (`requiredScope` `sokosumi:api`) and a
 * JWT at `/mcp` (`sokosumi:mcp`, ADR 0076). The caller has already checked the
 * token itself (signature or stored row, expiry, revocation).
 *
 * Banning a user, disabling a client, or withdrawing consent takes effect on
 * the next request through these checks, even for a JWT nobody can revoke.
 */
export async function checkOAuthGrant<User extends ActiveUserCandidate>(
  grant: OAuthGrant<User>,
  requiredScope: string,
): Promise<OAuthGrantStatus> {
  // A ban clears sessions but leaves bearer tokens usable until they expire.
  if (!isActiveUser(grant.user)) {
    return "inactive";
  }

  const { client } = grant;
  if (!client || client.disabled) {
    return "inactive";
  }

  // The token is valid from here; what remains is whether it may call this
  // resource. Identity-only tokens (openid alone) never can.
  if (!hasOAuthScope(grant.tokenScopes, requiredScope)) {
    return "insufficient_scope";
  }

  // The client's allow-list must still include the scope (e.g. after
  // privilege reduction). Checked before consent so reduced clients skip the
  // consent query.
  if (!hasOAuthScope(client.scopes, requiredScope)) {
    return "insufficient_scope";
  }

  // A first-party client skips consent, so it has no consent row (ADR 0046).
  if (client.skipConsent) {
    return "active";
  }

  const consent = await prisma.oauthConsent.findFirst({
    where: { userId: grant.userId, clientId: grant.clientId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { scopes: true },
  });
  if (!consent) {
    return "inactive";
  }
  return hasOAuthScope(consent.scopes, requiredScope)
    ? "active"
    : "insufficient_scope";
}
