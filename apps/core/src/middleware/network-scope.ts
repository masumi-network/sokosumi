import { createError } from "evlog";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import { createNetworkScope, type NetworkScope } from "@/lib/db/network-scope";

declare module "hono" {
  interface ContextVariableMap {
    /** Absent on a router that does not run `networkScopeMiddleware`. */
    networkScope?: NetworkScope;
  }
}

/** Creates the Network scope of a request, beside its authentication context. */
export const networkScopeMiddleware = createMiddleware(async (c, next) => {
  // The one place a request names its Network.
  c.set("networkScope", createNetworkScope("mainnet"));
  await next();
});

/**
 * The Network scope of the request. A handler reads it here and passes it, or
 * one side of it, down as an argument.
 */
export function requireNetworkScope(c: Context): NetworkScope {
  const scope = c.var.networkScope;
  if (!scope) {
    throw createError({
      message: "This request has no Network scope",
      why: "The route's router does not run networkScopeMiddleware",
      fix: "Mount the route on OpenAPIHonoWithAuth, or create a scope in its entry point",
    });
  }
  return scope;
}
