import * as Sentry from "@sentry/node";
import type { Context, MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { matchedRoutes } from "hono/route";

import type { AuthVariables } from "./auth.js";

const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
]);

// Requests that matched no concrete route only carry wildcard middleware
// entries. Reporting their raw path would send unknown paths, and any
// capability tokens in them, to Sentry.
const UNMATCHED_ROUTE = "UNMATCHED";

function redactHeaders(
  headers: IterableIterator<[string, string]>,
): Record<string, string> {
  return Object.fromEntries(
    Array.from(headers, ([key, value]) => [
      key,
      SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? REDACTED_VALUE : value,
    ]),
  );
}

// Paths can carry capability tokens (share links, invite links, password
// reset). Only the matched route template is safe to report.
function matchedRouteTemplate(c: Context): string {
  try {
    // Wildcard entries are the middleware mounts (`/*`, `/v1/*`). Skipping
    // them keeps the concrete route even when a `use("*")` is registered
    // below the routes it wraps, where the last entry is the wildcard.
    const path = matchedRoutes(c).findLast(
      (route) => !route.path.endsWith("*"),
    )?.path;
    return path ?? UNMATCHED_ROUTE;
  } catch {
    // matchedRoutes reads a hono internal. Observability must not 500 a
    // request if that internal ever moves.
    return UNMATCHED_ROUTE;
  }
}

// The concrete URL can carry capability tokens in the path and secrets in
// query values. Report the origin plus the route template instead.
function redactedUrl(rawUrl: string, routeTemplate: string): string {
  if (routeTemplate === UNMATCHED_ROUTE) {
    return UNMATCHED_ROUTE;
  }
  try {
    return `${new URL(rawUrl).origin}${routeTemplate}`;
  } catch {
    return REDACTED_VALUE;
  }
}

export function sentryMiddleware(): MiddlewareHandler<{
  Variables: RequestIdVariables & Partial<AuthVariables>;
}> {
  return async (c, next) => {
    const routeTemplate = matchedRouteTemplate(c);
    const url = redactedUrl(c.req.url, routeTemplate);

    return await Sentry.withIsolationScope(async () => {
      return await Sentry.startSpan(
        {
          op: "http.server",
          name: `${c.req.method} ${routeTemplate}`,
          attributes: {
            "http.method": c.req.method,
            "http.route": routeTemplate,
            "http.url": url,
            "request.id": c.var.requestId,
          },
        },
        async () => {
          const scope = Sentry.getCurrentScope();
          scope.setUser(null);
          scope.setContext("request", {
            method: c.req.method,
            url,
            path: routeTemplate,
            requestId: c.var.requestId,
            headers: redactHeaders(c.req.raw.headers.entries()),
          });

          try {
            await next();

            const span = Sentry.getActiveSpan();
            if (span) {
              span.setAttribute("http.status_code", c.res.status);
            }
          } catch (error) {
            const span = Sentry.getActiveSpan();
            if (span) {
              span.setAttribute("http.status_code", 500);
            }

            throw error;
          }
        },
      );
    });
  };
}
