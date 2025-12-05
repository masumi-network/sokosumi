import * as Sentry from "@sentry/node";
import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import type { AuthVariables } from "./auth.js";

export function sentryMiddleware(): MiddlewareHandler<{
  Variables: RequestIdVariables & Partial<AuthVariables>;
}> {
  return async (c, next) => {
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
        Sentry.getCurrentScope().setContext("request", {
          method: c.req.method,
          url: c.req.url,
          path: c.req.path,
          requestId: c.var.requestId,
          headers: Object.fromEntries(c.req.raw.headers.entries()),
        });

        const authContext = c.var.authContext;
        if (authContext && c.var.isAuthenticated) {
          Sentry.getCurrentScope().setUser({
            id: authContext.userId,
            organizationId: authContext.organizationId || undefined,
          });
        }

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
  };
}
