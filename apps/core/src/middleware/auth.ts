import { Context } from "hono";
import { bearerAuth } from "hono/bearer-auth";

import { env } from "../config/env";
import { auth } from "../lib/auth";

interface InternalAuthContext {
  type: "internal";
}

interface UserAuthContext {
  type: "user";
  userId: string;
  organizationId: string | null;
}

export type AuthContext = InternalAuthContext | UserAuthContext;

export const requireAuth = bearerAuth({
  verifyToken: async (token, c: Context) => {
    // Check 1: Static API_KEY (internal service)
    if (token === env.API_KEY) {
      c.set("auth", { type: "internal" } as InternalAuthContext);
      return true;
    }

    // Check 2: Better-Auth API Key (user)
    // Matches pattern from apps/web/src/lib/auth/utils.ts
    const result = await auth.api.verifyApiKey({
      body: { key: token },
    });

    if (result.valid && result.key) {
      c.set("auth", {
        type: "user",
        userId: result.key.userId,
        organizationId: result.key.metadata?.organizationId ?? null,
      } as UserAuthContext);
      return true;
    }

    return false;
  },
});
