import "server-only";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { APIError } from "better-auth/api";

import { CoreApiRequestError } from "@/lib/clients/core.client";

/**
 * Maps Core subscription-seat write errors back onto the APIError statuses
 * callers (the subscription action) expect. Returns the mapped APIError, or
 * `undefined` when the error is not a Core request error or carries no
 * recognized status — letting the caller fall back to its default handling.
 *
 * A missing organization is matched by the stable `organization_not_found`
 * kind (Core always tags the 404 with it); a 403 is the owner/admin write
 * guard. Both surface as FORBIDDEN like the previous in-process guard. A 400
 * (no active subscription, seats below assigned members, or enterprise
 * exclusivity) keeps Core's message.
 */
export function mapCoreSubscriptionSeatsWriteError(
  error: unknown,
): APIError | undefined {
  if (!(error instanceof CoreApiRequestError)) {
    return undefined;
  }

  if (
    error.kind === CORE_API_ERROR_KINDS.ORGANIZATION_NOT_FOUND ||
    error.status === 403
  ) {
    return new APIError("FORBIDDEN", {
      message: "Only organization owners and admins can manage subscriptions",
    });
  }

  if (error.status === 400) {
    return new APIError("BAD_REQUEST", {
      message: error.message,
    });
  }

  return undefined;
}
