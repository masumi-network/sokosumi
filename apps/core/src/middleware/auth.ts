import * as Sentry from "@sentry/node";
import { hasCoreApiOAuthScope } from "@sokosumi/utils";
import type { Context, MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { createMiddleware } from "hono/factory";

import { forbidden, unauthorized } from "@/helpers/error";
import { auth } from "@/lib/auth";
import { COWORKER_API_KEY_PREFIX, hashApiKey } from "@/lib/coworker-api-key";
import prisma from "@/lib/db/prisma";
import { isOrchestratorServiceToken } from "@/lib/orchestrator-service-token";

const DEFAULT_USER_ROLE = "user";

export interface UserAuthenticationContext {
  actor: "user";
  userId: string;
  organizationId: string | null;
  /** Comma-separated roles from `User.role` (Better Auth / Prisma). */
  role: string;
}

/**
 * Optional user/org workspace scope for coworker keys / orchestrator service
 * token via `X-Context-*` headers. Shared by both actors — not coworker-specific.
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

export interface OrchestratorAuthenticationContext {
  actor: "orchestrator";
  /**
   * Per-user orchestrator row id when user scope is known (context headers
   * or resolved from body). Absent after bare service-token auth.
   */
  orchestratorId?: string;
  context?: WorkspaceActorRequestContext;
}

export type AuthenticationContext =
  | UserAuthenticationContext
  | CoworkerAuthenticationContext
  | OrchestratorAuthenticationContext;

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

  if (context.authContext.actor === "orchestrator") {
    const orchestrator = context.authContext;
    scope.setUser({
      id: orchestrator.orchestratorId
        ? `orchestrator:${orchestrator.orchestratorId}`
        : "orchestrator:service",
      ...(orchestrator.orchestratorId
        ? { orchestratorId: orchestrator.orchestratorId }
        : {}),
    });
    if (orchestrator.context) {
      scope.setContext("orchestratorContext", {
        userId: orchestrator.context.userId,
        organizationId: orchestrator.context.organizationId,
      });
    }
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

export function setAuthContext(c: Context<AuthEnv>, context: AuthVariables) {
  c.set("isAuthenticated", context.isAuthenticated);
  c.set("authContext", context.authContext);
  syncSentryUser(context);
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

export function isOrchestratorAuthContext(
  authContext: AuthenticationContext,
): authContext is OrchestratorAuthenticationContext {
  return authContext.actor === "orchestrator";
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
 * or a coworker key / orchestrator service token with context headers
 * (`source: "context"`). Use {@link requireUserAuthContext} when the operation
 * must not run under coworker context (PII, session-bound consent, etc.).
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
 * coworker/orchestrator with workspace context). Contextual actors must send
 * `X-Context-User-Id` (and optional org header validated in middleware).
 */
export function requireUserContext(
  authContext: AuthenticationContext,
): UserContext {
  if (isUserAuthContext(authContext)) {
    return { source: "session", ...authContext };
  }

  if (
    isCoworkerAuthContext(authContext) ||
    isOrchestratorAuthContext(authContext)
  ) {
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
 * Requires an interactive user session (Better Auth). Rejects coworker and
 * orchestrator keys, including contextual ones — use for PII, session-bound
 * operations, and any handler that must read the real session user (e.g.
 * before an admin-role check).
 *
 * For the effective user (session or contextual coworker/orchestrator), use
 * {@link requireUserContext}.
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
 * Rejects orchestrator actors (bare or contextual). Use on surfaces that are
 * user/coworker-only (marketplace chat, task scheduling) even when
 * {@link requireUserContext} would accept an orchestrator with workspace context.
 */
export function forbidOrchestratorActor(
  authContext: AuthenticationContext,
  message: string,
): void {
  if (isOrchestratorAuthContext(authContext)) {
    throw forbidden(message);
  }
}

export function requireCoworkerAuthContext(
  authContext: AuthenticationContext,
): CoworkerAuthenticationContext {
  if (!isCoworkerAuthContext(authContext)) {
    throw forbidden("Coworker authentication required");
  }

  return authContext;
}

export function requireOrchestratorAuthContext(
  authContext: AuthenticationContext,
): OrchestratorAuthenticationContext {
  if (!isOrchestratorAuthContext(authContext)) {
    throw forbidden("Orchestrator authentication required");
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

/**
 * Verifies the global orchestrator service token (env) and sets actor context.
 * Per-user `orchestratorId` is bound later from user scope (context/body).
 */
function verifyOrchestratorServiceToken(
  token: string,
  c: Context<AuthEnv>,
): boolean {
  if (!isOrchestratorServiceToken(token)) {
    return false;
  }

  setAuthContext(c, {
    isAuthenticated: true,
    authContext: {
      actor: "orchestrator",
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

    // Verify that consent still exists (user hasn't revoked access)
    // and still grants Core API scope.
    const consent = await tx.oauthConsent.findFirst({
      where: {
        userId: oauthToken.userId,
        clientId: oauthToken.clientId,
      },
      select: {
        id: true,
        scopes: true,
      },
    });

    if (!consent || !hasCoreApiOAuthScope(consent.scopes)) {
      return null;
    }

    // Client allow-list must still include Core API (e.g. after privilege reduction).
    const client = oauthToken.client;
    if (!client || client.disabled || !hasCoreApiOAuthScope(client.scopes)) {
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

    // Check 2: Global orchestrator service token (Hermes → Core)
    if (verifyOrchestratorServiceToken(token, c)) {
      return true;
    }

    // Check 3: Better Auth API key
    const apiKeyValid = await verifyApiKey(token, c);
    if (apiKeyValid) {
      return true;
    }

    // Check 4: OAuth Access Token
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
