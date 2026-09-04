import { createAuthMiddleware } from "evlog/better-auth";
import type { EvlogVariables } from "evlog/hono";
import type { MiddlewareHandler } from "hono";

import { auth } from "@/lib/auth";

/**
 * Documented Hono wiring: https://www.evlog.dev/use-cases/better-auth/overview
 *
 * Auth lives at `/auth`, not `/api/auth`. Ids only — no avatar, session, or UA.
 */
const identify = createAuthMiddleware(auth, {
  exclude: ["/auth/**", "/sync/**", "/debug/**"],
  maskEmail: true,
  session: false,
  fields: ["id", "email"],
});

export function betterAuthEvlogMiddleware(): MiddlewareHandler<EvlogVariables> {
  return async (c, next) => {
    const log = c.get("log");
    // Bearer / API-key / coworker / sokoBot: auth middleware picks that
    // actor. Cookie identify must not run first or user/session from the
    // browser cookie land on a service-credential event.
    if (log && !c.req.header("authorization")) {
      await identify(log, c.req.raw.headers, c.req.path);
    }

    return await next();
  };
}
