import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { OAUTH_SCOPE_MCP } from "@sokosumi/utils";
import { isAPIError } from "better-auth/api";

import prisma from "@/lib/db/prisma";
import type { UserAuthenticationContext } from "@/middleware/auth";
import { BEARER_USER_SELECT } from "@/middleware/auth-active-user";
import {
  checkOAuthGrant,
  OAUTH_GRANT_CLIENT_SELECT,
} from "@/middleware/auth-oauth-grant";

import { mcpResourceIdentifier } from "./resource";

/** The Better Auth instance that issued the token: `auth` from `@/lib/auth`. */
type IssuingAuth = NonNullable<
  Parameters<typeof oauthProviderResourceClient>[0]
>;

/**
 * - `invalid_token`: answer 401, so the client signs the user in again.
 * - `insufficient_scope`: answer 403 naming `sokosumi:mcp`, so the client
 *   reauthorizes with it.
 */
export type McpTokenVerification =
  | { status: "active"; authContext: UserAuthenticationContext }
  | { status: "invalid_token" }
  | { status: "insufficient_scope" };

/**
 * Verifies a bearer token presented to Core's MCP server (ADR 0076).
 *
 * The token must be a JWT access token from this issuer, checked against the
 * issuer's own JWKS without a network call: signature, `iss`, `typ` `at+jwt`,
 * expiry, and `aud` naming `{origin}/mcp`. An opaque token, an ID token, an
 * API key, or a JWT for another resource is `invalid_token`; the MCP server
 * never passes a token through. Then the grant checks `/v1` runs for opaque
 * tokens, with `sokosumi:mcp` as the required scope.
 *
 * Infrastructure failures (the JWKS or the database unreachable) throw.
 */
export async function verifyMcpAccessToken(
  token: string,
  auth: IssuingAuth,
): Promise<McpTokenVerification> {
  const issuer = (await auth.$context).baseURL;
  let claims: Awaited<ReturnType<typeof verifyBearerToken>>;
  try {
    claims = await verifyBearerToken(
      auth,
      token,
      mcpResourceIdentifier(issuer),
    );
  } catch (error) {
    if (isAPIError(error) && error.status === "UNAUTHORIZED") {
      return { status: "invalid_token" };
    }
    throw error;
  }

  const userId = claims.sub;
  const clientId = claims.client_id;
  if (typeof userId !== "string" || typeof clientId !== "string") {
    return { status: "invalid_token" };
  }

  const [user, client] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: BEARER_USER_SELECT,
    }),
    prisma.oauthClient.findUnique({
      where: { clientId },
      select: OAUTH_GRANT_CLIENT_SELECT,
    }),
  ]);
  const status = await checkOAuthGrant(
    {
      userId,
      clientId,
      tokenScopes: typeof claims.scope === "string" ? claims.scope : "",
      user,
      client,
    },
    OAUTH_SCOPE_MCP,
  );
  if (status === "inactive") {
    return { status: "invalid_token" };
  }
  if (status === "insufficient_scope") {
    return { status };
  }

  return {
    status: "active",
    authContext: {
      actor: "user",
      userId,
      organizationId: null,
      role: user?.role ?? "user",
      authenticationMethod: "oauth",
      oauthClientId: clientId,
      ...(client?.skipConsent ? { firstPartyClient: true } : {}),
    },
  };
}

function verifyBearerToken(auth: IssuingAuth, token: string, audience: string) {
  return oauthProviderResourceClient(auth)
    .getActions()
    .verifyBearerToken(token, {
      // Better Auth types access tokens `at+jwt` (RFC 9068), so an ID token
      // signed with the same keys never passes as one.
      verifyOptions: { audience, typ: "at+jwt" },
    });
}
