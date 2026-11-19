import { getCookies, parseSetCookieHeader } from "better-auth/cookies";
import { createAuthMiddleware } from "evlog/better-auth";
import type { EvlogVariables } from "evlog/hono";
import type { MiddlewareHandler } from "hono";

import { auth } from "@/lib/auth";
import { deferBetterAuthRequestLogs } from "@/lib/evlog-library-logs";

/**
 * Documented Hono wiring: https://www.evlog.dev/use-cases/better-auth/overview
 *
 * Auth lives at `/auth`, not `/api/auth`. Ids only — no avatar, session, or UA.
 */
const identify = createAuthMiddleware(auth, {
  exclude: ["/auth/**", "/sync/**"],
  maskEmail: true,
  session: false,
  fields: ["id", "email"],
});

const CLIENT_AUTH_REDIRECT_ERRORS = new Set([
  "access_denied",
  "no_code",
  "state_mismatch",
  "state_not_found",
]);

function isClientCausedRedirect(
  response: Response,
  requestUrl: string,
): boolean {
  if (response.status < 300 || response.status >= 400) return false;
  const location = response.headers.get("location");
  const errorURL = auth.options.onAPIError?.errorURL;
  if (!location || !errorURL) return false;

  const redirect = URL.parse(location, requestUrl);
  const errorPage = URL.parse(errorURL, requestUrl);
  if (
    !redirect ||
    !errorPage ||
    redirect.origin !== errorPage.origin ||
    redirect.pathname !== errorPage.pathname
  ) {
    return false;
  }

  const errors = redirect.searchParams.getAll("error");
  if (errors.length !== 1 || !CLIENT_AUTH_REDIRECT_ERRORS.has(errors[0])) {
    return false;
  }

  // The error page itself can also be the callback URL of a successful sign-in.
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return true;
  const { sessionToken } = getCookies(auth.options);
  return !parseSetCookieHeader(setCookie).get(sessionToken.name)?.value;
}

export function betterAuthEvlogMiddleware(): MiddlewareHandler<EvlogVariables> {
  return async (c, next) => {
    const log = c.get("log");
    if (log && c.req.path.startsWith("/auth/")) {
      const flush = deferBetterAuthRequestLogs(log);
      try {
        await next();
      } finally {
        flush(isClientCausedRedirect(c.res, c.req.url));
      }
      return;
    }
    // Bearer / API-key / coworker / sokoBot: auth middleware picks that
    // actor. Cookie identify must not run first or user/session from the
    // browser cookie land on a service-credential event.
    if (log && !c.req.header("authorization")) {
      await identify(log, c.req.raw.headers, c.req.path);
    }

    return await next();
  };
}
