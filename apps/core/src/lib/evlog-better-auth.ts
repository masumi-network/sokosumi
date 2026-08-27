import { createAuthMiddleware } from "evlog/better-auth";
import type { EvlogVariables } from "evlog/hono";
import type { MiddlewareHandler } from "hono";

import { auth } from "@/lib/auth";

/**
 * Documented Hono wiring: https://www.evlog.dev/use-cases/better-auth/overview
 *
 * Auth lives at `/auth`, not `/api/auth`. Mask emails before Sentry Logs.
 */
const identify = createAuthMiddleware(auth, {
  exclude: ["/auth/**", "/sync/**", "/debug/**"],
  maskEmail: true,
});

export function betterAuthEvlogMiddleware(): MiddlewareHandler<EvlogVariables> {
  return async (c, next) => {
    const log = c.get("log");
    if (log) {
      await identify(log, c.req.raw.headers, c.req.path);
    }

    return await next();
  };
}
