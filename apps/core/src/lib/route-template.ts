import type { Context } from "hono";
import { matchedRoutes } from "hono/route";

/**
 * Reported in place of a path when no concrete route matched. Reporting the
 * raw path instead would send unknown paths, and any capability tokens in
 * them, to the observability backends.
 */
export const UNMATCHED_ROUTE = "UNMATCHED";

/**
 * The matched route template for a request, for example `/v1/share/:token`.
 *
 * Concrete paths carry capability tokens (share links, invite links, password
 * reset links). Only the template is safe to report, so both the Sentry
 * middleware and the evlog request logger label requests with this instead of
 * `c.req.path`.
 */
export function matchedRouteTemplate(c: Context): string {
  try {
    const matched = matchedRoutes(c);

    // Prefer a concrete route. Wildcard entries are middleware mounts (`/*`,
    // `/v1/*`), so skipping them keeps the real route even when a `use("*")`
    // is registered below the routes it wraps and matches last.
    const concrete = matched.findLast(
      (route) => !route.path.endsWith("*"),
    )?.path;
    if (concrete) {
      return concrete;
    }

    // No concrete route. A mount prefix still identifies the traffic and
    // contains no token, so it beats UNMATCHED: the Better Auth catch-all is
    // registered as `/auth/*`, and reporting every sign-in as UNMATCHED would
    // hide all auth traffic behind the 404 bucket. The bare root wildcards
    // say nothing, so those still fall through.
    const mount = matched.findLast(
      (route) => route.path !== "*" && route.path !== "/*",
    )?.path;
    return mount ?? UNMATCHED_ROUTE;
  } catch {
    // matchedRoutes reads a hono internal. Observability must not 500 a
    // request if that internal ever moves.
    return UNMATCHED_ROUTE;
  }
}
