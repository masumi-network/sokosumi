import { createNetworkScope, type NetworkScope } from "@/lib/db/network-scope";

/**
 * The Mainnet scope for a fixture that builds a request's variables by hand,
 * as `networkScopeMiddleware` would set it. It builds no client until read.
 */
export function testNetworkScope(): NetworkScope {
  return createNetworkScope("mainnet");
}
