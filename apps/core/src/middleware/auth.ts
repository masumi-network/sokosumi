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

const bearerMiddleware: MiddlewareHandler<{
  Variables: AuthVariables;
}> = bearerAuth({
  verifyToken: async (token, c) => {
    // Check: Better-Auth API Key
    const result = await auth.api.verifyApiKey({
      body: { key: token },
    });

    if (result.valid && result.key) {
      setAuthContext(c, {
        isAuthenticated: true,
        authContext: {
          userId: result.key.userId,
          organizationId: result.key.metadata?.organizationId ?? null,
        },
      });
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
