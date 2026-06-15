import "server-only";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { APIError } from "better-auth/api";

import { CoreApiRequestError } from "@/lib/clients/core.client";

const ORGANIZATION_SUBSCRIPTION_ADMIN_REQUIRED_MESSAGE =
  "Only organization owners and admins can manage subscriptions";

/**
 * Maps Core subscription-seat write errors onto APIError statuses the
 * subscription action expects.
 *
 * Missing organizations and insufficient role are intentionally surfaced with
 * the same owner/admin copy so callers cannot distinguish them. Non-membership
 * keeps Core's message. Unrecognized Core errors return `undefined` so the
 * caller can fall back to `toCoreApiActionError` (401, 5xx, etc.).
 */
export function mapCoreSubscriptionSeatsWriteError(
  error: unknown,
): APIError | undefined {
  if (!(error instanceof CoreApiRequestError)) {
    return undefined;
  }

  if (
    error.kind === CORE_API_ERROR_KINDS.ORGANIZATION_NOT_FOUND ||
    error.kind === CORE_API_ERROR_KINDS.ORGANIZATION_ROLE_FORBIDDEN
  ) {
    return new APIError("FORBIDDEN", {
      message: ORGANIZATION_SUBSCRIPTION_ADMIN_REQUIRED_MESSAGE,
    });
  }

  if (error.kind === CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED) {
    return new APIError("FORBIDDEN", {
      message: error.message,
    });
  }

  if (error.status === 400) {
    return new APIError("BAD_REQUEST", {
      message: error.message,
    });
  }

  // Legacy responses without a kind: treat 403/404 like owner/admin guard.
  if (error.status === 403 || error.status === 404) {
    return new APIError("FORBIDDEN", {
      message: ORGANIZATION_SUBSCRIPTION_ADMIN_REQUIRED_MESSAGE,
    });
  }

  return undefined;
}
