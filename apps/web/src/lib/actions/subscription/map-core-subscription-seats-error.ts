import "server-only";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { APIError } from "better-auth/api";

import {
  type ActionError,
  betterAuthApiErrorSchema,
  CommonErrorCode,
} from "@/lib/actions/errors";
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";

const ORGANIZATION_SUBSCRIPTION_ADMIN_REQUIRED_MESSAGE =
  "Only organization owners and admins can manage subscriptions";

/**
 * Maps Core subscription-seat write errors onto APIError statuses the
 * subscription action expects.
 *
 * Seat updates intentionally avoid `toCoreApiActionError` alone: missing orgs
 * and insufficient role must share owner/admin copy (not Core's 404 NOT_FOUND),
 * while membership and validation errors keep Core's message.
 *
 * Unrecognized Core errors return `undefined` so the caller can fall back to
 * `toCoreApiActionError` (401, 5xx, etc.).
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

function getBetterAuthErrorStatus(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const errorWithStatus = error as Error & { status?: unknown };
  return typeof errorWithStatus.status === "string"
    ? errorWithStatus.status
    : null;
}

function parseMappedSubscriptionSeatsApiError(error: unknown): ActionError {
  const parsedBetterAuthError = betterAuthApiErrorSchema.safeParse(error);
  if (parsedBetterAuthError.success) {
    return {
      code: parsedBetterAuthError.data.body.code,
      message: parsedBetterAuthError.data.body.message,
    };
  }

  const status = getBetterAuthErrorStatus(error);
  if (status === "FORBIDDEN") {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      ...(error instanceof Error ? { message: error.message } : {}),
    };
  }

  if (status === "BAD_REQUEST") {
    return {
      code: CommonErrorCode.BAD_INPUT,
      ...(error instanceof Error ? { message: error.message } : {}),
    };
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    ...(error instanceof Error ? { message: error.message } : {}),
  };
}

export function toSubscriptionSeatsActionError(error: unknown): ActionError {
  const mappedError = mapCoreSubscriptionSeatsWriteError(error);
  if (mappedError) {
    return parseMappedSubscriptionSeatsApiError(mappedError);
  }

  if (error instanceof CoreApiRequestError) {
    return toCoreApiActionError(error);
  }

  return parseMappedSubscriptionSeatsApiError(error);
}
