import { createAuthMiddleware } from "evlog/better-auth";
import { useLogger } from "evlog/hono";
import type { MiddlewareHandler } from "hono";

import { auth } from "@/lib/auth";

/**
 * Documented Hono wiring: https://www.evlog.dev/use-cases/better-auth/overview
 *
 * Auth lives at `/auth`, not `/api/auth`. Mask emails before Sentry Logs.
 */
const identify = createAuthMiddleware(auth, {
  exclude: ["/auth/**"],
  maskEmail: true,
});

export function betterAuthEvlogMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    let log: ReturnType<typeof useLogger> | undefined;
    try {
      log = useLogger();
    } catch {
      log = undefined;
    }

    if (log) {
      await identify(log, c.req.raw.headers, c.req.path);
    }

    return await next();
  };
}
