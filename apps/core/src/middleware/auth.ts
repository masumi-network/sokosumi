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

function setAuthContext(
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
  try {
    const introspectionResult = await auth.api.oauth2Introspect({
      body: { token },
    });

    console.log("introspectionResult", introspectionResult);
    if (
      introspectionResult.active &&
      introspectionResult.userId &&
      typeof introspectionResult.userId === "string"
    ) {
      // OAuth tokens always have null organizationId
      setAuthContext(c, {
        isAuthenticated: true,
        authContext: {
          userId: introspectionResult.userId,
          organizationId: null,
        },
      });
      return true;
    }
  } catch {
    // If introspection fails, token is invalid
    // Return false to indicate verification failed
  }

  return false;
}

const bearerMiddleware: MiddlewareHandler<{
  Variables: AuthVariables;
}> = bearerAuth({
  verifyToken: async (token, c) => {
    // Check 1: Better-Auth API Key
    if (await verifyApiKey(token, c)) {
      return true;
    }

    // Check 2: OAuth Access Token (using Better Auth introspection API)
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
