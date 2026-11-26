import { createMiddleware } from "hono/factory";

import { createNetworkScope, type NetworkScope } from "@/lib/db/network-scope";

export interface NetworkScopeVariables {
  networkScope: NetworkScope;
}

/**
 * Creates the Network scope of a request, beside its authentication context.
 * Handlers read `c.var.networkScope` and pass it, or one side of it, down as
 * an argument.
 */
export const networkScopeMiddleware = createMiddleware<{
  Variables: Partial<NetworkScopeVariables>;
}>(async (c, next) => {
  // A nested router runs this again: the request keeps its one scope.
  if (!c.var.networkScope) {
    // The one place a request names its Network.
    c.set("networkScope", createNetworkScope("mainnet"));
  }
  await next();
});
