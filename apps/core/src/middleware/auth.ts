import type { MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";

import { unauthorized } from "@/helpers/error";
import { auth } from "@/lib/auth";

export interface AuthenticatedUserContext {
  id: string;
  organizationId: string | null;
}

export type AuthVariables = {
  isAuthenticated: boolean;
  user?: AuthenticatedUserContext;
};

function setAuthContext(
  c: Parameters<MiddlewareHandler>[0],
  context: AuthVariables,
) {
  c.set("isAuthenticated", context.isAuthenticated);
  c.set("user", context.user);
}

const bearerMiddleware: MiddlewareHandler<{
  Variables: AuthVariables;
}> = bearerAuth({
  verifyToken: async (token, c) => {
    // Check 1: Static API_KEY (internal service)
    if (token === process.env.API_KEY) {
      setAuthContext(c, { isAuthenticated: true, user: undefined });
      return true;
    }

    // Check 2: Better-Auth API Key (user)
    const result = await auth.api.verifyApiKey({
      body: { key: token },
    });

    if (result.valid && result.key) {
      setAuthContext(c, {
        isAuthenticated: true,
        user: {
          id: result.key.userId,
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
      user: {
        id: user.id,
        organizationId: session.activeOrganizationId ?? null,
      },
    });

    await next();
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
