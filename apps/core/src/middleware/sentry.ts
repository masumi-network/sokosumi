import * as Sentry from "@sentry/node";
import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import type { AuthVariables } from "./auth.js";

/**
 * Sentry middleware for Hono
 * Wraps requests in Sentry spans for performance monitoring
 * Adds request context and user information to Sentry events
 */
export function sentryMiddleware(): MiddlewareHandler<{
  Variables: RequestIdVariables & Partial<AuthVariables>;
}> {
  return async (c, next) => {
    // Use Sentry v10+ startSpan API for performance monitoring
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
        // Add request context
        Sentry.getCurrentScope().setContext("request", {
          method: c.req.method,
          url: c.req.url,
          path: c.req.path,
          requestId: c.var.requestId,
          headers: Object.fromEntries(c.req.raw.headers.entries()),
        });

        // Add user context if authenticated (auth middleware runs before this)
        const authContext = c.var.authContext;
        if (authContext && c.var.isAuthenticated) {
          Sentry.getCurrentScope().setUser({
            id: authContext.userId,
            organizationId: authContext.organizationId || undefined,
          });
        }

        try {
          await next();

          // Set HTTP status code as span attribute
          const span = Sentry.getActiveSpan();
          if (span) {
            span.setAttribute("http.status_code", c.res.status);
          }
        } catch (error) {
          // Set error status as span attribute
          const span = Sentry.getActiveSpan();
          if (span) {
            span.setAttribute("http.status_code", 500);
          }

          // Re-throw to let error handler capture and process it
          // The error handler will decide whether to send to Sentry (5xx only)
          throw error;
        }
      },
    );
  };
}
