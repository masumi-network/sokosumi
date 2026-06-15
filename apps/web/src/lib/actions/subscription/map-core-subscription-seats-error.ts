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
 * The `kind` check is the preferred, machine-readable match; the status/message
 * checks are status-level fallbacks for the same conditions. Core responds 403
 * when the caller is not an owner or admin and 404 when the organization is
 * missing — both surfaced as FORBIDDEN like the previous in-process guard. A
 * 400 (no active subscription, seats below assigned members, or enterprise
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
    error.status === 403 ||
    (error.status === 404 && error.message === "Organization not found")
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
