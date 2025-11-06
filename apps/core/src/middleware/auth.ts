import type { MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";

import { env } from "../config/env";
import { unauthorized } from "../helpers/error";
import { auth } from "../lib/auth";

export interface InternalAuth {
  type: "internal";
}

export interface UserAuth {
  type: "user";
  userId: string;
  organizationId: string | null;
  sessionId: string | null;
}

export type AuthType = InternalAuth | UserAuth;

const bearerMiddleware = bearerAuth({
  verifyToken: async (token, c) => {
    // Check 1: Static API_KEY (internal service)
    if (token === env.API_KEY) {
      c.set("auth", { type: "internal" } as InternalAuth);
      return true;
    }

    // Check 2: Better-Auth API Key (user)
    const result = await auth.api.verifyApiKey({
      body: { key: token },
    });

    if (result.valid && result.key) {
      c.set("auth", {
        type: "user",
        userId: result.key.userId,
        organizationId: result.key.metadata?.organizationId ?? null,
        sessionId: null,
      } as UserAuth);
      return true;
    } else {
      unauthorized("Invalid token");
    }
    return false;
  },
});

const sessionMiddleware: MiddlewareHandler<{
  Variables: { auth: AuthType };
}> = async (c, next) => {
  const response = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (response?.session && response.user) {
    const { session, user } = response;

    c.set("auth", {
      type: "user",
      userId: user.id,
      organizationId: session.activeOrganizationId ?? null,
      sessionId: session.id,
    } as UserAuth);
    await next();
  } else {
    unauthorized();
  }
};

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header("authorization");
  if (authHeader) {
    await bearerMiddleware(c, next);
  } else {
    await sessionMiddleware(c, next);
  }
};
