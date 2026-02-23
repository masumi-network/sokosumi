import type { Context, MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { createMiddleware } from "hono/factory";

import { forbidden, unauthorized } from "@/helpers/error";
import { auth } from "@/lib/auth";
import { COWORKER_API_KEY_PREFIX, hashApiKey } from "@/lib/coworker-api-key";
import prisma from "@/lib/db/prisma";

export interface UserAuthenticationContext {
  actor: "user";
  userId: string;
  organizationId: string | null;
  isAdmin: boolean;
}

export interface CoworkerAuthenticationContext {
  actor: "coworker";
  coworkerId: string;
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

function isAdminRole(role: string | null | undefined): boolean {
  if (!role) {
    return false;
  }

  return role
    .split(",")
    .some((value) => value.trim().toLowerCase() === "admin");
}

async function getIsAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      role: true,
    },
  });

  return isAdminRole(user?.role);
}

export function setAuthContext(c: Context<AuthEnv>, context: AuthVariables) {
  c.set("isAuthenticated", context.isAuthenticated);
  c.set("authContext", context.authContext);
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

export function requireUserAuthContext(
  authContext: AuthenticationContext,
): UserAuthenticationContext {
  if (!isUserAuthContext(authContext)) {
    throw forbidden("User authentication required");
  }

  return authContext;
}

export function requireCoworkerAuthContext(
  authContext: AuthenticationContext,
): CoworkerAuthenticationContext {
  if (!isCoworkerAuthContext(authContext)) {
    throw forbidden("Coworker authentication required");
  }

  return authContext;
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
    body: { key: token },
  });

  if (apiKeyResult.valid && apiKeyResult.key) {
    const isAdmin = await getIsAdmin(apiKeyResult.key.userId);
    setAuthContext(c, {
      isAuthenticated: true,
      authContext: {
        actor: "user",
        userId: apiKeyResult.key.userId,
        organizationId: null,
        isAdmin,
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

  setAuthContext(c, {
    isAuthenticated: true,
    authContext: {
      actor: "coworker",
      coworkerId: coworkerApiKey.coworkerId,
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
 * Checks token existence, expiration, refresh token revocation, and consent validity.
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

    // Check if refresh token is revoked (if token has a refreshId)
    if (oauthToken.refreshId && oauthToken.refreshToken) {
      if (oauthToken.refreshToken.revoked) {
        return null;
      }
    }

    // Verify that consent still exists (user hasn't revoked access)
    const consent = await tx.oauthConsent.findFirst({
      where: {
        userId: oauthToken.userId,
        clientId: oauthToken.clientId,
      },
    });

    if (!consent) {
      return null;
    }

    return oauthToken;
  });

  if (!oauthToken || !oauthToken.userId) {
    return false;
  }

  const isAdmin = await getIsAdmin(oauthToken.userId);
  setAuthContext(c, {
    isAuthenticated: true,
    authContext: {
      actor: "user",
      userId: oauthToken.userId,
      organizationId: null,
      isAdmin,
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
  const isAdmin = await getIsAdmin(user.id);
  setAuthContext(c, {
    isAuthenticated: true,
    authContext: {
      actor: "user",
      userId: user.id,
      organizationId: session.activeOrganizationId ?? null,
      isAdmin,
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
