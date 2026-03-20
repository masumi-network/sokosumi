import * as Sentry from "@sentry/node";
import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import type { AuthVariables } from "./auth.js";

const REDACTED_HEADER_VALUE = "[REDACTED]";
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
]);

function redactHeaders(
  headers: IterableIterator<[string, string]>,
): Record<string, string> {
  return Object.fromEntries(
    Array.from(headers, ([key, value]) => [
      key,
      SENSITIVE_HEADER_NAMES.has(key.toLowerCase())
        ? REDACTED_HEADER_VALUE
        : value,
    ]),
  );
}

export function sentryMiddleware(): MiddlewareHandler<{
  Variables: RequestIdVariables & Partial<AuthVariables>;
}> {
  return async (c, next) => {
    return await Sentry.withIsolationScope(async () => {
      return await Sentry.startSpan(
        {
          op: "http.server",
          name: `${c.req.method} ${c.req.path}`,
          attributes: {
            "http.method": c.req.method,
            "http.route": c.req.path,
            "http.url": c.req.url,
            "request.id": c.var.requestId,
          },
        },
        async () => {
          const scope = Sentry.getCurrentScope();
          scope.setUser(null);
          scope.setContext("request", {
            method: c.req.method,
            url: c.req.url,
            path: c.req.path,
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
