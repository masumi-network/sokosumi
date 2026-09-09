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
