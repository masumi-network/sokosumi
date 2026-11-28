import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";

import { forbidden, unprocessableEntity } from "@/helpers/error";
import type { AuthenticationContext } from "@/middleware/auth";
import { NETWORK_HEADER, requestNetwork } from "@/middleware/network-scope";

export const MAINNET_ONLY_FEATURE_MESSAGE =
  "This feature is available on Mainnet only.";

/**
 * Refuses a request to a Mainnet-only feature when the request names Preprod:
 * either via `X-Sokosumi-Network: preprod` or, while Preprod is on, via a
 * verified Preprod API key without the header.
 *
 * Decides purely from the request and already-verified authentication context:
 * performs no database read and no Preprod access check, returning the same
 * 422 `mainnet_only_feature` whether Preprod is off or on and whether the
 * caller has Preprod access or not. Unknown header values stay 400
 * `network_unknown` (via `requestNetwork`), and an API key whose Network the
 * header contradicts stays 403 `api_key_network_mismatch`.
 */
export function requireMainnetOnlyFeature(c: Context): void {
  const headerNetwork = requestNetwork(c);
  const headerSent = c.req.header(NETWORK_HEADER) !== undefined;
  const authContext = c.get("authContext") as AuthenticationContext | undefined;
  const keyNetwork =
    authContext?.actor === "user" ? authContext.apiKeyNetwork : undefined;

  if (keyNetwork && headerSent && keyNetwork !== headerNetwork) {
    throw forbidden(
      `This API key is for ${keyNetwork}, and ${NETWORK_HEADER} names ${headerNetwork}`,
      { kind: CORE_API_ERROR_KINDS.API_KEY_NETWORK_MISMATCH },
    );
  }

  const effectiveNetwork = headerSent
    ? headerNetwork
    : (keyNetwork ?? headerNetwork);

  if (effectiveNetwork === "preprod") {
    throw unprocessableEntity(MAINNET_ONLY_FEATURE_MESSAGE, {
      kind: CORE_API_ERROR_KINDS.MAINNET_ONLY_FEATURE,
    });
  }
}

export const requireMainnetOnlyFeatureMiddleware = createMiddleware(
  async (c, next) => {
    requireMainnetOnlyFeature(c);
    await next();
  },
);

export function requireMainnetOnlyFeatureForMethods(
  methods: readonly string[],
) {
  const allowed = new Set(methods);
  return createMiddleware(async (c, next) => {
    if (allowed.has(c.req.method)) {
      requireMainnetOnlyFeature(c);
    }
    await next();
  });
}
