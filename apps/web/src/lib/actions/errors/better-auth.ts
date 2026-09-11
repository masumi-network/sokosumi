import * as z from "zod";

export const ORGANIZATION_HAS_ADDITIONAL_MEMBERS_ERROR_CODE =
  "ORGANIZATION_HAS_ADDITIONAL_MEMBERS";

export const LAST_WORKSPACE_ERROR_CODE = "LAST_WORKSPACE";

export const TASK_PAYMENT_CLAIM_PENDING_ERROR_CODE =
  "TASK_PAYMENT_CLAIM_PENDING";

export const TASK_PAYMENT_CLAIM_REVIEW_REQUIRED_ERROR_CODE =
  "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED";

export const USER_OWNS_ORGANIZATION_ERROR_CODE = "USER_OWNS_ORGANIZATION";

export const IN_FLIGHT_JOB_ERROR_CODE = "IN_FLIGHT_JOB";

export const UNSETTLED_ON_CHAIN_JOB_ERROR_CODE = "UNSETTLED_ON_CHAIN_JOB";

export const IN_FLIGHT_TASK_ERROR_CODE = "IN_FLIGHT_TASK";

export const RUNNING_SUBSCRIPTION_ERROR_CODE = "RUNNING_SUBSCRIPTION";

export const ENTERPRISE_CONTRACT_ACTIVE_ERROR_CODE =
  "ENTERPRISE_CONTRACT_ACTIVE";

export const TASK_X402_PAYMENT_PENDING_ERROR_CODE = "TASK_X402_PAYMENT_PENDING";

export const TASK_X402_PAYMENT_UNRESOLVED_ERROR_CODE =
  "TASK_X402_PAYMENT_UNRESOLVED";

export const TASK_X402_PAYMENT_AUTHORIZATION_LIVE_ERROR_CODE =
  "TASK_X402_PAYMENT_AUTHORIZATION_LIVE";

export const TASK_X402_PAYMENT_BILLING_OWNER_MISMATCH_ERROR_CODE =
  "TASK_X402_PAYMENT_BILLING_OWNER_MISMATCH";

/**
 * Better Auth rejects a sensitive route when the session is older than the
 * configured `freshAge`. Signing in again is what clears it.
 */
export const SESSION_NOT_FRESH_ERROR_CODE = "SESSION_NOT_FRESH";

export function isSessionNotFreshError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return error.code === SESSION_NOT_FRESH_ERROR_CODE;
}

export const betterAuthApiErrorSchema = z.object({
  status: z.string(),
  statusCode: z.number(),
  body: z.object({
    code: z.string(),
    message: z.string().nullish(),
  }),
});

export type BetterAuthClientError = {
  code?: string | undefined;
  message?: string | undefined;
  status: number;
  statusText: string;
};

export type BetterAuthClientResult<T> = {
  data: T;
  error: BetterAuthClientError | null;
};
