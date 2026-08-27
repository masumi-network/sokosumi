import * as Sentry from "@sentry/node";
import { hasCoreApiOAuthScope } from "@sokosumi/utils";
import type { Context, MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { createMiddleware } from "hono/factory";

import { forbidden, unauthorized } from "@/helpers/error";
import { auth } from "@/lib/auth";
import { COWORKER_API_KEY_PREFIX, hashApiKey } from "@/lib/coworker-api-key";
import prisma from "@/lib/db/prisma";
import { attachAuthToLogger } from "@/lib/evlog";

const DEFAULT_USER_ROLE = "user";

export interface UserAuthenticationContext {
  actor: "user";
  userId: string;
  organizationId: string | null;
  /** Comma-separated roles from `User.role` (Better Auth / Prisma). */
  role: string;
  /** Credential class used to authenticate this request. */
  authenticationMethod?: "session" | "api_key" | "oauth";
}

/**
 * Optional user/org workspace scope for coworker keys via `X-Context-*` headers.
 */
export interface WorkspaceActorRequestContext {
  userId: string;
  organizationId: string | null;
}

export interface CoworkerAuthenticationContext {
  actor: "coworker";
  coworkerId: string;
  vendorId: string;
  context?: WorkspaceActorRequestContext;
}

export type AuthenticationContext =
  | UserAuthenticationContext
  | CoworkerAuthenticationContext;

export type AuthVariables = {
  isAuthenticated: boolean;
  authContext: AuthenticationContext;
};

export type AuthEnv = {
  Variables: AuthVariables;
};

function syncSentryUser(context: AuthVariables) {
  const scope = Sentry.getCurrentScope();

  if (!context.isAuthenticated) {
    scope.setUser(null);
    return;
  }

  if (context.authContext.actor === "user") {
    scope.setUser({
      id: context.authContext.userId,
      organizationId: context.authContext.organizationId || undefined,
    });
    return;
  }

  const coworker = context.authContext;
  scope.setUser({
    id: `coworker:${coworker.coworkerId}`,
    coworkerId: coworker.coworkerId,
  });
  if (coworker.context) {
    scope.setContext("coworkerContext", {
      userId: coworker.context.userId,
      organizationId: coworker.context.organizationId,
    });
  }
}

function syncRequestLogger(context: AuthVariables) {
  if (!context.isAuthenticated) {
    attachAuthToLogger({ actor: "anonymous" });
    return;
  }

  const { authContext } = context;

  if (isUserAuthContext(authContext)) {
    attachAuthToLogger({
      actor: "user",
      userId: authContext.userId,
      organizationId: authContext.organizationId,
    });
    return;
  }

  if (isCoworkerAuthContext(authContext)) {
    attachAuthToLogger({
      actor: "coworker",
      coworkerId: authContext.coworkerId,
      contextUserId: authContext.context?.userId,
      contextOrganizationId: authContext.context?.organizationId,
    });
    return;
  }

  const _exhaustive: never = authContext;
  void _exhaustive;
}

export function setAuthContext(c: Context<AuthEnv>, context: AuthVariables) {
  c.set("isAuthenticated", context.isAuthenticated);
  c.set("authContext", context.authContext);
  syncSentryUser(context);
  syncRequestLogger(context);
}

export function isUserAuthContext(
  authContext: AuthenticationContext,
): authContext is UserAuthenticationContext {
  return authContext.actor === "user";
}

export function isCoworkerAuthContext(
  authContext: AuthenticationContext,
): authContext is CoworkerAuthenticationContext {
  return authContext.actor === "coworker";
}

/**
 * True only for a coworker acting as itself — the agent, with no context headers.
 * A coworker that supplies workspace context acts in that user's workspace, so this
 * returns false for it (use {@link requireUserContext} / the user code paths in that case).
 *
 * Use to gate agent-only semantics (coworker status transitions, agent task
 * payments) that must NOT apply when a coworker is impersonating a user.
 *
 * Returns a plain boolean, not a type predicate: a `false` result is not
 * necessarily a user — it may be a delegated coworker — so narrowing the
 * negative branch to `UserAuthenticationContext` would be unsound.
 */
export function isCoworkerAgentContext(
  authContext: AuthenticationContext,
): boolean {
  return isCoworkerAuthContext(authContext) && !authContext.context;
}

/**
 * Effective user context for a handler: either a Better Auth session (`source: "session"`)
 * or a coworker key with context headers
 * (`source: "context"`).
 *
 * ## Handler actor menu (pick one helper — do not branch on `actor` in routes)
 *
 * | Helper | Who | When |
 * | --- | --- | --- |
 * | {@link requireUserContext} | Session or **coworker+context (unbound)** | Task/job grant-gated flows only (e.g. first-contact delegated create → `GRANT_PENDING`). Does **not** check vendor grants. |
 * | `requireAuthorizedUserContext` (`@/helpers/coworker-user-context-binding`) | Session or coworker+context **after** grant/baseline binding | Default for **user-scoped** reads/writes (profile, credits, projects, org metadata, …). DENIED/REVOKED grants win over assignment. |
 * | {@link requireOwnerUserContext} | Session only | Human/owner surfaces: notifications, history, billing, member lists, … **No coworker.** |
 * | {@link requireUserAuthContext} | Interactive session only | Must be the real session user (admin role check, consent, …). Rejects coworker. |
 *
 * Middleware (`coworkerContextMiddleware`) only **attaches** validated
 * `X-Context-*` headers. Policy lives in these helpers — not per-handler
 * `if (actor === "coworker")` checks.
 */
export type UserContext =
  | ({ source: "session" } & UserAuthenticationContext)
  | {
      source: "context";
      userId: string;
      organizationId: string | null;
    };

/**
 * Resolves the effective user context for this request (session user or
 * coworker with workspace context). Contextual actors must send
 * `X-Context-User-Id` (and optional org header validated in middleware).
 *
 * **No vendor-grant check.** Prefer `requireAuthorizedUserContext` (see
 * `@/helpers/coworker-user-context-binding`) for user-scoped operations so
 * coworkers cannot act as arbitrary users. Prefer {@link requireOwnerUserContext}
 * when coworkers must not run the handler at all. Keep this helper for task/job
 * paths that intentionally allow unbound coworker context (delegated create /
 * grant gates live in access-control).
 */
export function requireUserContext(
  authContext: AuthenticationContext,
): UserContext {
  if (isUserAuthContext(authContext)) {
    return { source: "session", ...authContext };
  }

  if (isCoworkerAuthContext(authContext)) {
    const context = authContext.context;
    if (!context) {
      throw forbidden(
        "Context headers (X-Context-User-Id) are required for this resource",
      );
    }

    return {
      source: "context",
      userId: context.userId,
      organizationId: context.organizationId,
    };
  }

  throw forbidden("User authentication required");
}

/**
 * Requires an interactive user session (Better Auth). Rejects coworker keys,
 * including contextual ones — use for PII, session-bound
 * operations, and any handler that must read the real session user (e.g.
 * before an admin-role check).
 *
 * For the effective user (session or contextual coworker), use
 * {@link requireUserContext}, `requireAuthorizedUserContext`, or
 * {@link requireOwnerUserContext} per the handler actor menu on {@link UserContext}.
 */
export function requireUserAuthContext(
  authContext: AuthenticationContext,
): UserAuthenticationContext {
  if (!isUserAuthContext(authContext)) {
    throw forbidden("User authentication required");
  }

  return authContext;
}

/**
 * Rejects coworker actors (bare or contextual). Use on owner-only mutations
 * where {@link requireUserContext} would otherwise treat `X-Context-User-Id` as
 * the resource owner (task owner, org owner/admin, etc.).
 */
export function forbidCoworkerActor(
  authContext: AuthenticationContext,
  message = "Coworker authentication cannot perform this owner action",
): void {
  if (isCoworkerAuthContext(authContext)) {
    throw forbidden(message);
  }
}

/**
 * Owner-mutation / human-only user context: session user. Rejects coworker
 * actors (bare or contextual) so
 * `X-Context-User-Id` cannot impersonate the resource owner.
 *
 * Use for notifications, history, billing, org member lists, and similar
 * surfaces. See the handler actor menu on {@link UserContext}.
 */
export function requireOwnerUserContext(
  authContext: AuthenticationContext,
  message = "Coworker authentication cannot perform this owner action",
): UserContext {
  forbidCoworkerActor(authContext, message);
  return requireUserContext(authContext);
}

export function requireCoworkerAuthContext(
  authContext: AuthenticationContext,
): CoworkerAuthenticationContext {
  if (!isCoworkerAuthContext(authContext)) {
    throw forbidden("Coworker authentication required");
  }

  return authContext;
}

export function hasAdminRole(role: string | null | undefined): boolean {
  return (
    role?.split(",").some((value) => value.trim().toLowerCase() === "admin") ??
    false
  );
}

export function requireAdminAuthContext(
  authContext: AuthenticationContext,
): UserAuthenticationContext {
  const userAuthContext = requireUserAuthContext(authContext);

  if (!hasAdminRole(userAuthContext.role)) {
    throw forbidden("Admin access required");
  }

  return userAuthContext;
}

/**
 * Requires a browser-backed interactive admin session for money-moving actions.
 * Generic user API keys and OAuth access tokens deliberately remain valid for
 * ordinary admin reads, but cannot mint refunds or resolve held charges.
 */
export function requireInteractiveAdminAuthContext(
  authContext: AuthenticationContext,
): UserAuthenticationContext {
  const userAuthContext = requireAdminAuthContext(authContext);

  if (userAuthContext.authenticationMethod !== "session") {
    throw forbidden("Interactive admin session required for this money action");
  }

  return userAuthContext;
}

/**
 * Verifies a Better Auth API key and sets the authentication context if valid.
 *
 * @param token - The API key token to verify
 * @param c - The Hono context
 * @returns `true` if the API key is valid and context was set, `false` otherwise
 */
async function verifyApiKey(
  token: string,
  c: Context<AuthEnv>,
): Promise<boolean> {
  const apiKeyResult = await auth.api.verifyApiKey({
    body: { configId: "default", key: token },
  });

  if (apiKeyResult.valid && apiKeyResult.key) {
    const dbUser = await prisma.user.findUnique({
      where: { id: apiKeyResult.key.referenceId },
      select: { role: true },
    });

    setAuthContext(c, {
      isAuthenticated: true,
      authContext: {
        actor: "user",
        userId: apiKeyResult.key.referenceId,
        organizationId: null,
        role: dbUser?.role ?? DEFAULT_USER_ROLE,
        authenticationMethod: "api_key",
      },
    });
    return true;
  }

  return false;
}

/**
 * Verifies a dedicated coworker API key and sets coworker auth context if valid.
 *
 * Expected token format: coworker_<secret>
 */
async function verifyCoworkerApiKey(
  token: string,
  c: Context<AuthEnv>,
): Promise<boolean> {
  if (!token.startsWith(COWORKER_API_KEY_PREFIX)) {
    return false;
  }

  const keyHash = await hashApiKey(token);
  const coworkerApiKey = await prisma.coworkerApiKey.findUnique({
    where: {
      keyHash,
    },
    select: {
      coworkerId: true,
      revokedAt: true,
      expiresAt: true,
      coworker: {
        select: {
          archivedAt: true,
          vendorId: true,
        },
      },
    },
  });

  if (!coworkerApiKey) {
    return false;
  }

  if (coworkerApiKey.revokedAt) {
    return false;
  }

  if (coworkerApiKey.expiresAt && coworkerApiKey.expiresAt <= new Date()) {
    return false;
  }

  if (coworkerApiKey.coworker.archivedAt) {
    return false;
  }

  setAuthContext(c, {
    isAuthenticated: true,
    authContext: {
      actor: "coworker",
      coworkerId: coworkerApiKey.coworkerId,
      vendorId: coworkerApiKey.coworker.vendorId,
    },
  });
  return true;
}

const hashAccessToken = async (value: string) => {
  const tokenWithoutPrefix = value.replace(/^soko_access_token_/, "");
  return await hashApiKey(tokenWithoutPrefix);
};

/**
 * Verifies an OAuth access token and sets the authentication context if valid.
 * Requires `sokosumi:api` on the access token, consent, and the client's
 * allow-list (`OauthClient.scopes`). Rejects disabled clients.
 * `openid`-only tokens are identity-scoped and must not authenticate Core `/v1`.
 *
 * @param token - The OAuth access token to verify
 * @param c - The Hono context
 * @returns `true` if the token is valid and context was set, `false` otherwise
 */
async function verifyOAuthToken(
  token: string,
  c: Context<AuthEnv>,
): Promise<boolean> {
  const hashedToken = await hashAccessToken(token);
  const oauthToken = await prisma.$transaction(async (tx) => {
    const oauthToken = await tx.oauthAccessToken.findUnique({
      where: { token: hashedToken },
      include: {
        refreshToken: true,
        user: {
          select: { role: true },
        },
        client: {
          select: {
            disabled: true,
            scopes: true,
          },
        },
      },
    });

    if (!oauthToken) {
      return null;
    }

    // Check if token is expired
    if (oauthToken.expiresAt < new Date()) {
      return null;
    }

    // Verify user exists (OAuth tokens should have a userId)
    if (!oauthToken.userId) {
      return null;
    }

    // Identity-only tokens (openid without sokosumi:api) cannot call Core API.
    if (!hasCoreApiOAuthScope(oauthToken.scopes)) {
      return null;
    }

    // Check if refresh token is revoked (if token has a refreshId)
    if (oauthToken.refreshId && oauthToken.refreshToken) {
      if (oauthToken.refreshToken.revoked) {
        return null;
      }
    }

    // Client allow-list must still include Core API (e.g. after privilege reduction).
    // Check before consent so disabled/reduced clients skip the consent query.
    const client = oauthToken.client;
    if (!client || client.disabled || !hasCoreApiOAuthScope(client.scopes)) {
      return null;
    }

    // Verify that consent still exists (user hasn't revoked access)
    // and still grants Core API scope.
    const consent = await tx.oauthConsent.findFirst({
      where: {
        userId: oauthToken.userId,
        clientId: oauthToken.clientId,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        scopes: true,
      },
    });

    if (!consent || !hasCoreApiOAuthScope(consent.scopes)) {
      return null;
    }

    return oauthToken;
  });

  if (!oauthToken || !oauthToken.userId) {
    return false;
  }

  setAuthContext(c, {
    isAuthenticated: true,
    authContext: {
      actor: "user",
      userId: oauthToken.userId,
      organizationId: null,
      role: oauthToken.user?.role ?? DEFAULT_USER_ROLE,
      authenticationMethod: "oauth",
    },
  });
  return true;
}

const bearerMiddleware: MiddlewareHandler<AuthEnv> = bearerAuth({
  verifyToken: async (token, c) => {
    // Check 1: Dedicated coworker API key
    // Coworker-prefixed tokens must not fall back to user auth schemes.
    if (token.startsWith(COWORKER_API_KEY_PREFIX)) {
      const coworkerApiKeyValid = await verifyCoworkerApiKey(token, c);
      if (coworkerApiKeyValid) {
        return true;
      }

      throw unauthorized("Invalid or expired coworker token");
    }

    // Check 2: Better Auth API key
    const apiKeyValid = await verifyApiKey(token, c);
    if (apiKeyValid) {
      return true;
    }

    // Check 3: OAuth Access Token
    const oauthTokenValid = await verifyOAuthToken(token, c);
    if (oauthTokenValid) {
      return true;
    }

    throw unauthorized("Invalid or expired token");
  },
});

const sessionMiddleware: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const response = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!response?.session || !response.user) {
    throw unauthorized("Invalid, expired or missing session");
  }

  const { session, user } = response;
  setAuthContext(c, {
    isAuthenticated: true,
    authContext: {
      actor: "user",
      userId: user.id,
      organizationId: session.activeOrganizationId ?? null,
      role: user.role ?? DEFAULT_USER_ROLE,
      authenticationMethod: "session",
    },
  });
  return await next();
};
export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header("authorization");

  if (authHeader) {
    return bearerMiddleware(c, next);
  }

  return sessionMiddleware(c, next);
});
