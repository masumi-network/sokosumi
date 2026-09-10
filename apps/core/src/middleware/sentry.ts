import * as Sentry from "@sentry/node";
import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import { matchedRouteTemplate, UNMATCHED_ROUTE } from "@/lib/route-template";
import type { AuthVariables } from "./auth.js";

const REDACTED_VALUE = "[REDACTED]";
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
      SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? REDACTED_VALUE : value,
    ]),
  );
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

    return await Sentry.withIsolationScope(async (isolationScope) => {
      const redactedHeaders = redactHeaders(c.req.raw.headers.entries());

      // The SDK's own http server subscription already put the raw request on
      // this scope before any middleware ran: `normalizedRequest` feeds
      // `requestDataIntegration` (which writes `event.request.url`), and the
      // transaction name is the raw path on error events. Overwrite both.
      // This does NOT reach the auto server span, whose attributes come from
      // the node request; that span is disabled in `initSentry` instead.
      isolationScope.setTransactionName(`${c.req.method} ${routeTemplate}`);
      isolationScope.setSDKProcessingMetadata({
        normalizedRequest: {
          method: c.req.method,
          url,
          query_string: undefined,
          headers: redactedHeaders,
          cookies: undefined,
          data: undefined,
        },
      });

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
            headers: redactedHeaders,
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
