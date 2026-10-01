import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { CoreApiRequestError } from "@/lib/clients/core.client";

/** Not set up on this deployment yet, or a failure worth trying again. */
export type MarketLoadError = "unavailable" | "failed";

/**
 * What a failed market load shows, by Core's error kind. Anything that is not
 * a Core failure (such as a lost session) still reaches the route's error
 * boundary.
 */
export function toMarketLoadError(error: unknown): MarketLoadError {
  if (!(error instanceof CoreApiRequestError)) throw error;
  return error.kind === CORE_API_ERROR_KINDS.INTEGRATION_NOT_CONFIGURED
    ? "unavailable"
    : "failed";
}
