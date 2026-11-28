import {
  CORE_API_ERROR_KINDS,
  hasAdminRole as checkAdminRole,
  OAUTH_SCOPE_CORE_API,
} from "@sokosumi/utils";
import type { Context, MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { createMiddleware } from "hono/factory";
import { getWebAppBaseUrl } from "@/config/env";
import { resolveAgentApiKeyAuthContext } from "@/helpers/agent-api-key-auth";
import { forbidden, unauthorized } from "@/helpers/error";
import {
  hashStoredOAuthToken,
  OAUTH_ACCESS_TOKEN_PREFIX,
} from "@/lib/auth-oauth-token-prefixes";
import {
  COWORKER_API_KEY_PREFIX,
  isSokoBotApiKeyToken,
} from "@/lib/coworker-api-key";
import prisma from "@/lib/db/prisma";
import { isNetworkRoutingEnabled, type Network } from "@/lib/network";
import { networkFromUserApiKeyPrefix } from "@/lib/user-api-key";

import { BEARER_USER_SELECT, isActiveUser } from "./auth-active-user";
import { checkOAuthGrant, OAUTH_GRANT_CLIENT_SELECT } from "./auth-oauth-grant";
import { syncAuthObservers } from "./auth-observability";

export const DEFAULT_USER_ROLE = "user";

export interface UserAuthenticationContext {
  actor: "user";
  userId: string;
  organizationId: string | null;
  /** Comma-separated roles from `User.role` (Better Auth / Prisma). */
  role: string;
  /** Credential class used to authenticate this request. */
  authenticationMethod?: "session" | "api_key" | "oauth";
  /**
   * An OAuth token from a first-party client (`skipConsent`, ADR 0046), such
   * as CMO or the Apple app: a person signed in right there, so the routes
   * that use {@link requireFirstPartyUserAuthContext} accept it.
   */
  firstPartyClient?: boolean;
  /** The OAuth client that issued the token, for `authenticationMethod: "oauth"`. */
  oauthClientId?: string;
  /**
   * The Network of the API key's stored prefix, for `authenticationMethod:
   * "api_key"`, set only while Preprod is on: the Network scope holds it
   * against `X-Sokosumi-Network` (`src/middleware/network-scope.ts`).
   */
  apiKeyNetwork?: Network;
  /**
   * Admin user id when this session impersonates another user (Better Auth
   * `impersonatedBy`). Absent otherwise. `userId`/`role` always describe the
   * effective (target) user.
   */
  impersonatedBy?: string;
  /** Better Auth session id, for `authenticationMethod: "session"`. */
  sessionId?: string;
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

interface SokoBotAuthenticationContextBase {
  actor: "sokoBot";
  sokoBotId: string;
  workspaceId: string;
}

/** A personal bot acts as its owner, so it carries the owner's user id. */
export interface PersonalSokoBotAuthenticationContext
  extends SokoBotAuthenticationContextBase {
  scope: "personal";
  userId: string;
  organizationId: string | null;
}

/**
 * A project or workspace bot is its own principal: no user, always an
 * Organization workspace. `projectId` is set only for project scope.
 */
export interface SharedSokoBotAuthenticationContext
  extends SokoBotAuthenticationContextBase {
  scope: "project" | "workspace";
  userId: null;
  organizationId: string;
  projectId: string | null;
}

export type SokoBotAuthenticationContext =
  | PersonalSokoBotAuthenticationContext
  | SharedSokoBotAuthenticationContext;

export type AuthenticationContext =
  | UserAuthenticationContext
  | CoworkerAuthenticationContext
  | SokoBotAuthenticationContext;

export type AuthVariables = {
  isAuthenticated: boolean;
  authContext: AuthenticationContext;
};

export type AuthEnv = {
  Variables: AuthVariables;
};

export function setAuthContext(c: Context<AuthEnv>, context: AuthVariables) {
  c.set("isAuthenticated", context.isAuthenticated);
  c.set("authContext", context.authContext);
  syncAuthObservers(context);
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

export function isSokoBotAuthContext(
  authContext: AuthenticationContext,
): authContext is SokoBotAuthenticationContext {
  return authContext.actor === "sokoBot";
}

export function isPersonalSokoBotAuthContext(
  authContext: AuthenticationContext,
): authContext is PersonalSokoBotAuthenticationContext {
  return isSokoBotAuthContext(authContext) && authContext.scope === "personal";
}

export function isSharedSokoBotAuthContext(
  authContext: AuthenticationContext,
): authContext is SharedSokoBotAuthenticationContext {
  return isSokoBotAuthContext(authContext) && authContext.scope !== "personal";
}

const SHARED_SOKO_BOT_NO_USER_MESSAGE =
  "A shared Soko Bot has no user context for this resource";

/**
 * Narrows a Soko Bot context to a personal one, or answers 403 for a shared
 * bot on a path that has no shared branch.
 */
export function requirePersonalSokoBotAuthContext(
  authContext: SokoBotAuthenticationContext,
): PersonalSokoBotAuthenticationContext {
  if (authContext.scope !== "personal") {
    throw forbidden(SHARED_SOKO_BOT_NO_USER_MESSAGE);
  }
  return authContext;
}

/**
 * Identifies the caller for an impersonation-denial audit. Coworker and
 * Soko Bot actors audit as evlog `agent` (the union has no coworker/sokoBot
 * type); anything else keeps the historical `user` shape.
 */
export function denialAuditActor(authContext: AuthenticationContext): {
  actorId: string;
  actorType: "user" | "agent";
} {
  if (isCoworkerAuthContext(authContext)) {
    return { actorId: authContext.coworkerId, actorType: "agent" };
  }
  if (isSokoBotAuthContext(authContext)) {
    return { actorId: authContext.sokoBotId, actorType: "agent" };
  }
  return { actorId: "unknown", actorType: "user" };
}

/**
 * True for an sokoBot or a coworker acting as itself with no context headers.
 * A coworker that supplies workspace context acts in that user's workspace, so this
 * returns false for it (use {@link requireUserContext} / the user code paths in that case).
 *
 * Use to gate agent-only semantics (agent status transitions, agent task
 * payments) that must NOT apply when a coworker is impersonating a user.
 *
 * Returns a plain boolean, not a type predicate: a `false` result is not
 * necessarily a user — it may be a delegated coworker — so narrowing the
 * negative branch to `UserAuthenticationContext` would be unsound.
 */
export function isAgentAuthContext(
  authContext: AuthenticationContext,
): boolean {
  return (
    (isCoworkerAuthContext(authContext) && !authContext.context) ||
    isSokoBotAuthContext(authContext)
  );
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
 * | {@link requireUserAuthContext} | A person by any sign-in: session, API key, OAuth or MCP token | Must be the person, not an agent acting for them (admin role check, a person's own data). Rejects coworker and Soko Bot. For a browser session only, use {@link requireInteractiveUserAuthContext}. |
 * | {@link resolveUserContext} | Session, personal Soko Bot, or coworker+context → effective user; standalone coworker → `null` | Routes where Task collaboration already decides access, but user-scoped gates (organization seat) must follow the effective user. |
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
 *
 * A shared Soko Bot has no user, so it gets 403 here and from every helper
 * built on this one.
 */
export function requireUserContext(
  authContext: AuthenticationContext,
): UserContext {
  if (isUserAuthContext(authContext)) {
    return { source: "session", ...authContext };
  }

  if (isSokoBotAuthContext(authContext)) {
    const sokoBot = requirePersonalSokoBotAuthContext(authContext);
    return {
      source: "context",
      userId: sokoBot.userId,
      organizationId: sokoBot.organizationId,
    };
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
 * Effective user context when the actor can present one: interactive
 * sessions, Soko Bots, and coworkers supplying `X-Context-*` headers. Returns
 * `null` for a standalone coworker key, whose access is decided by the Task
 * collaboration helpers instead of user-scoped gates.
 *
 * Use where a route accepts both user-scoped gates (organization seats)
 * and standalone coworker actors: the gates apply to the
 * effective user whenever one exists.
 */
export function resolveUserContext(
  authContext: AuthenticationContext,
): UserContext | null {
  if (isCoworkerAuthContext(authContext) && !authContext.context) {
    return null;
  }

  return requireUserContext(authContext);
}

/**
 * Requires a person: a Better Auth session, a personal API key, or an OAuth
 * or MCP token. Rejects coworker keys (contextual ones too) and Soko Bots —
 * use for PII and any handler that must read the real user (e.g. before an
 * admin-role check). It does not require a browser: for that, use
 * {@link requireInteractiveUserAuthContext}.
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
 * Rejects agent actors (coworkers and Soko Bots). Use on owner-only mutations
 * where {@link requireUserContext} would otherwise treat `X-Context-User-Id` as
 * the resource owner (task owner, org owner/admin, etc.).
 */
export function forbidAgentActor(
  authContext: AuthenticationContext,
  message = "Agent authentication cannot perform this owner action",
): void {
  if (isCoworkerAuthContext(authContext) || isSokoBotAuthContext(authContext)) {
    throw forbidden(message);
  }
}

/**
 * Owner-mutation user context: a person by any sign-in (session, API key or
 * OAuth token). Rejects Coworker and Soko Bot actors so `X-Context-User-Id`
 * cannot impersonate the resource owner.
 *
 * Use for notifications, history, billing, org member lists, and similar
 * surfaces. See the handler actor menu on {@link UserContext}.
 */
export function requireOwnerUserContext(
  authContext: AuthenticationContext,
  message = "Agent authentication cannot perform this owner action",
): UserContext {
  forbidAgentActor(authContext, message);
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

export function requireSokoBotAuthContext(
  authContext: AuthenticationContext,
): SokoBotAuthenticationContext {
  if (!isSokoBotAuthContext(authContext)) {
    throw forbidden("SokoBot authentication required");
  }

  return authContext;
}

export function requireAgentAuthContext(
  authContext: AuthenticationContext,
): CoworkerAuthenticationContext | SokoBotAuthenticationContext {
  if (
    !isCoworkerAuthContext(authContext) &&
    !isSokoBotAuthContext(authContext)
  ) {
    throw forbidden("Agent authentication required");
  }

  return authContext;
}

// Canonical logic lives in @sokosumi/utils (shared with web); this keeps
// the existing Core import surface stable.
export function hasAdminRole(role: string | null | undefined): boolean {
  return checkAdminRole(role);
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
 * Requires a browser-backed interactive session, for issuing or revoking
 * long-lived credentials.
 *
 * {@link requireUserAuthContext} accepts every user actor, OAuth and Better
 * Auth API keys included, so without this a third-party OAuth client could
 * mint a personal-assistant key that keeps working after its consent is
 * revoked. The person has to be at the keyboard.
 */
export function requireInteractiveUserAuthContext(
  authContext: AuthenticationContext,
): UserAuthenticationContext {
  const userAuthContext = requireUserAuthContext(authContext);

  if (userAuthContext.authenticationMethod !== "session") {
    throw forbidden("Interactive session required to manage credentials");
  }

  return userAuthContext;
}

/** A person at the keyboard: a browser session, never an agent's credential. */
export function isPersonSession(
  authContext: AuthenticationContext,
): authContext is UserAuthenticationContext {
  return (
    isUserAuthContext(authContext) &&
    authContext.authenticationMethod === "session"
  );
}

/**
 * A person approves, publishes and sends (ADR 0077), so only a browser
 * session passes. Every agent (API key, OAuth or MCP token, Coworker, Soko
 * Bot) gets 403 `person_approval_required` with the item's Web link, so it
 * can send its user there.
 */
export function requirePersonApproval(
  authContext: AuthenticationContext,
  webPath: string,
): UserAuthenticationContext {
  if (isPersonSession(authContext)) {
    return authContext;
  }
  throw forbidden("A person approves this in Sokosumi", {
    kind: CORE_API_ERROR_KINDS.PERSON_APPROVAL_REQUIRED,
    extensions: { webUrl: new URL(webPath, getWebAppBaseUrl()).toString() },
  });
}

/**
 * Like {@link requireInteractiveUserAuthContext}, but a first-party client's
 * OAuth token passes too. Routes opt in one by one, so a stolen CMO or Apple
 * token can only do what those routes do, and can never mint a credential.
 */
export function requireFirstPartyUserAuthContext(
  authContext: AuthenticationContext,
): UserAuthenticationContext {
  const userAuthContext = requireUserAuthContext(authContext);

  if (
    userAuthContext.authenticationMethod === "oauth" &&
    userAuthContext.firstPartyClient === true
  ) {
    return userAuthContext;
  }

  return requireInteractiveUserAuthContext(authContext);
}

/** Requires a browser-backed interactive admin session for sensitive actions. */
export function requireInteractiveAdminAuthContext(
  authContext: AuthenticationContext,
): UserAuthenticationContext {
  const userAuthContext = requireAdminAuthContext(authContext);

  if (userAuthContext.authenticationMethod !== "session") {
    throw forbidden("Interactive admin session required for this action");
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
  const { auth } = await import("@/lib/auth");
  const apiKeyResult = await auth.api.verifyApiKey({
    body: { configId: "default", key: token },
  });

  if (apiKeyResult.valid && apiKeyResult.key) {
    const dbUser = await prisma.user.findUnique({
      where: { id: apiKeyResult.key.referenceId },
      select: BEARER_USER_SELECT,
    });

    // A key outlives its owner: deleting a user leaves the row behind, and
    // banning one does not touch it.
    if (!isActiveUser(dbUser)) {
      return false;
    }

    setAuthContext(c, {
      isAuthenticated: true,
      authContext: {
        actor: "user",
        userId: apiKeyResult.key.referenceId,
        organizationId: null,
        role: dbUser.role,
        authenticationMethod: "api_key",
        // From the row the plugin verified, so no read. While Preprod is off
        // the prefix is not read: every key is a Mainnet key, as before.
        ...(isNetworkRoutingEnabled()
          ? {
              apiKeyNetwork: networkFromUserApiKeyPrefix(
                apiKeyResult.key.prefix,
              ),
            }
          : {}),
      },
    });
    return true;
  }

  return false;
}

/**
 * Verifies a dedicated agent API key and preserves its database owner identity.
 */
async function verifyAgentApiKey(
  token: string,
  c: Context<AuthEnv>,
): Promise<boolean> {
  const authContext = await resolveAgentApiKeyAuthContext(token);
  if (!authContext) {
    return false;
  }

  setAuthContext(c, { isAuthenticated: true, authContext });
  return true;
}

/**
 * A valid OAuth token that lacks `sokosumi:api`: 403 with the RFC 6750 §3.1
 * challenge, so the integrator learns which scope to request instead of
 * reading the same 401 as a garbage token.
 */
function insufficientOAuthScope() {
  return forbidden(
    `OAuth access token lacks the ${OAUTH_SCOPE_CORE_API} scope`,
    {
      kind: CORE_API_ERROR_KINDS.INSUFFICIENT_SCOPE,
      wwwAuthenticate: `Bearer error="insufficient_scope", scope="${OAUTH_SCOPE_CORE_API}"`,
    },
  );
}

/**
 * Verifies an OAuth access token and sets the authentication context if valid.
 * Requires `sokosumi:api` on the access token, consent, and the client's
 * allow-list (`OauthClient.scopes`). Rejects disabled clients. A first-party
 * client (`OauthClient.skipConsent`) needs no consent.
 * `openid`-only tokens are identity-scoped and must not authenticate Core `/v1`.
 *
 * @param token - The OAuth access token to verify
 * @param c - The Hono context
 * @returns `true` if the token is valid and context was set, `false` otherwise
 * @throws 403 `insufficient_scope` when an otherwise valid token, its client,
 *   or its consent lacks `sokosumi:api`
 */
async function verifyOAuthToken(
  token: string,
  c: Context<AuthEnv>,
): Promise<boolean> {
  const hashedToken = hashStoredOAuthToken(token, OAUTH_ACCESS_TOKEN_PREFIX);
  const oauthToken = await prisma.oauthAccessToken.findUnique({
    where: { token: hashedToken },
    include: {
      refreshToken: true,
      user: {
        select: BEARER_USER_SELECT,
      },
      client: { select: OAUTH_GRANT_CLIENT_SELECT },
    },
  });

  if (!oauthToken) {
    return false;
  }

  if (oauthToken.expiresAt < new Date()) {
    return false;
  }

  // This access token revoked on its own. The refresh-token check below
  // covers a revoked grant, not a single token withdrawn from it.
  if (oauthToken.revoked) {
    return false;
  }

  if (!oauthToken.userId) {
    return false;
  }

  if (oauthToken.refreshId && oauthToken.refreshToken) {
    if (oauthToken.refreshToken.revoked) {
      return false;
    }
  }

  const status = await checkOAuthGrant(
    {
      userId: oauthToken.userId,
      clientId: oauthToken.clientId,
      tokenScopes: oauthToken.scopes,
      user: oauthToken.user,
      client: oauthToken.client,
    },
    OAUTH_SCOPE_CORE_API,
  );
  if (status === "insufficient_scope") {
    throw insufficientOAuthScope();
  }
  if (status === "inactive") {
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
      oauthClientId: oauthToken.clientId,
      ...(oauthToken.client?.skipConsent ? { firstPartyClient: true } : {}),
    },
  });
  return true;
}

const bearerMiddleware: MiddlewareHandler<AuthEnv> = bearerAuth({
  verifyToken: async (token, c) => {
    // Dedicated agent-prefixed tokens must not fall back to user auth schemes.
    if (
      token.startsWith(COWORKER_API_KEY_PREFIX) ||
      isSokoBotApiKeyToken(token)
    ) {
      const coworkerApiKeyValid = await verifyAgentApiKey(token, c);
      if (coworkerApiKeyValid) {
        return true;
      }

      throw unauthorized("Invalid or expired agent token");
    }

    // An OAuth access token is never an API key. Trying it as one makes
    // Better Auth log "Failed to validate API key" at error level.
    if (
      !token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX) &&
      (await verifyApiKey(token, c))
    ) {
      return true;
    }

    const oauthTokenValid = await verifyOAuthToken(token, c);
    if (oauthTokenValid) {
      return true;
    }

    throw unauthorized("Invalid or expired token");
  },
});

const sessionMiddleware: MiddlewareHandler<AuthEnv> = async (c, next) => {
  // Loaded on first use: this middleware is in every route's graph, and the
  // auth module drags better-auth, its plugins and Stripe into suites that
  // never reach a session. Same reason as `middleware/organization.ts`.
  const { auth } = await import("@/lib/auth");
  const response = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!response?.session || !response.user) {
    throw unauthorized("Invalid, expired or missing session");
  }

  const { session, user } = response;

  // Better Auth revokes a user's sessions when it bans or deletes them
  // (`deleteUserSessions` in both paths), so a stored session normally cannot
  // outlive either. This is defence in depth for a ban applied any other way,
  // such as a write straight to the column. `getSession` already returns the
  // ban columns, so it costs no extra query.
  if (!isActiveUser(user)) {
    throw unauthorized("Invalid, expired or missing session");
  }

  setAuthContext(c, {
    isAuthenticated: true,
    authContext: {
      actor: "user",
      userId: user.id,
      organizationId: session.activeOrganizationId ?? null,
      role: user.role ?? DEFAULT_USER_ROLE,
      authenticationMethod: "session",
      sessionId: session.id,
      ...(session.impersonatedBy
        ? { impersonatedBy: session.impersonatedBy }
        : {}),
    },
  });
  return await next();
};
/**
 * Requests Core builds itself and runs in process, with the caller they act
 * for: the MCP server dispatches a tool call to `/v1` this way
 * (`lib/sokosumi-mcp/dispatch.ts`) after it verified the caller's own token.
 * Only a `Request` object Core holds can be a key, so no header can forge one.
 */
export const preAuthenticatedRequests = new WeakMap<Request, AuthVariables>();

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const preAuthenticated = preAuthenticatedRequests.get(c.req.raw);
  if (preAuthenticated) {
    setAuthContext(c, preAuthenticated);
    return await next();
  }

  const authHeader = c.req.header("authorization");

  if (authHeader) {
    return bearerMiddleware(c, next);
  }

  return sessionMiddleware(c, next);
});
