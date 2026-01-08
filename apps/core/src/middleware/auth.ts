import { base64Url } from "@better-auth/utils/base64";
import { createHash } from "@better-auth/utils/hash";
import prisma from "@sokosumi/database/client";
import type { MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";

import { unauthorized } from "@/helpers/error";
import { auth } from "@/lib/auth";

export interface AuthenticationContext {
  userId: string;
  organizationId: string | null;
}

export type AuthVariables = {
  isAuthenticated: boolean;
  authContext: AuthenticationContext;
};

export function setAuthContext(
  c: Parameters<MiddlewareHandler>[0],
  context: AuthVariables,
) {
  c.set("isAuthenticated", context.isAuthenticated);
  c.set("authContext", context.authContext);
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
  c: Parameters<MiddlewareHandler>[0],
): Promise<boolean> {
  const apiKeyResult = await auth.api.verifyApiKey({
    body: { key: token },
  });

  if (apiKeyResult.valid && apiKeyResult.key) {
    setAuthContext(c, {
      isAuthenticated: true,
      authContext: {
        userId: apiKeyResult.key.userId,
        organizationId: apiKeyResult.key.metadata?.organizationId ?? null,
      },
    });
    return true;
  }

  return false;
}

const hashAccessToken = async (value: string) => {
  const tokenWithoutPrefix = value.replace(/^soko_access_token_/, "");
  return await defaultHasher(tokenWithoutPrefix);
};

const defaultHasher = async (value: string) => {
  const hash = await createHash("SHA-256").digest(
    new TextEncoder().encode(value),
  );
  const hashed = base64Url.encode(new Uint8Array(hash), {
    padding: false,
  });
  return hashed;
};

/**
 * Verifies an OAuth access token using Better Auth introspection API and sets the authentication context if valid.
 *
 * @param token - The OAuth access token to verify
 * @param c - The Hono context
 * @returns `true` if the token is valid and context was set, `false` otherwise
 */
async function verifyOAuthToken(
  token: string,
  c: Parameters<MiddlewareHandler>[0],
): Promise<boolean> {
  const hashedToken = await hashAccessToken(token);
  const oauthToken = await prisma.oauthAccessToken.findUnique({
    where: { token: hashedToken },
  });

  if (!oauthToken) {
    return false;
  }

  // Check if token is expired
  if (oauthToken.expiresAt < new Date()) {
    return false;
  }

  // Verify user exists (OAuth tokens should have a userId)
  if (!oauthToken.userId) {
    return false;
  }

  // OAuth tokens always have null organizationId
  setAuthContext(c, {
    isAuthenticated: true,
    authContext: {
      userId: oauthToken.userId,
      organizationId: null,
    },
  });
  return true;
}

const bearerMiddleware: MiddlewareHandler<{
  Variables: AuthVariables;
}> = bearerAuth({
  verifyToken: async (token, c) => {
    // Check 1: API Key
    if (await verifyApiKey(token, c)) {
      return true;
    }

    // Check 2: OAuth Access Token
    if (await verifyOAuthToken(token, c)) {
      return true;
    }

    throw unauthorized("Invalid token");
  },
});

const sessionMiddleware: MiddlewareHandler<{
  Variables: AuthVariables;
}> = async (c, next) => {
  const response = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (response?.session && response.user) {
    const { session, user } = response;

    setAuthContext(c, {
      isAuthenticated: true,
      authContext: {
        userId: user.id,
        organizationId: session.activeOrganizationId ?? null,
      },
    });

    return await next();
  }
  throw unauthorized();
};

export const authMiddleware: MiddlewareHandler<{
  Variables: AuthVariables;
}> = async (c, next) => {
  const authHeader = c.req.header("authorization");

  if (authHeader) {
    await bearerMiddleware(c, next);
  } else {
    await sessionMiddleware(c, next);
  }
};
