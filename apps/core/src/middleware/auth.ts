import type { MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";

import { unauthorized } from "../helpers/error.js";

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
    // Only static API_KEY check (better-auth removed for testing)
    if (token === Bun.env.API_KEY) {
      setAuthContext(c, { isAuthenticated: true, user: undefined });
      return true;
    }

    throw unauthorized("Invalid token");
  },
});

export const authMiddleware: MiddlewareHandler<{
  Variables: AuthVariables;
}> = async (c, next) => {
  const authHeader = c.req.header("authorization");

  if (authHeader) {
    await bearerMiddleware(c, next);
  } else {
    throw unauthorized("Authorization required");
  }
};
