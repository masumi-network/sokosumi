import * as z from "zod";

export const ORGANIZATION_HAS_ADDITIONAL_MEMBERS_ERROR_CODE =
  "ORGANIZATION_HAS_ADDITIONAL_MEMBERS";

export const LAST_WORKSPACE_ERROR_CODE = "LAST_WORKSPACE";

export const TASK_PAYMENT_CLAIM_PENDING_ERROR_CODE =
  "TASK_PAYMENT_CLAIM_PENDING";

export const TASK_PAYMENT_CLAIM_REVIEW_REQUIRED_ERROR_CODE =
  "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED";

export const RUNNING_SUBSCRIPTION_ERROR_CODE = "RUNNING_SUBSCRIPTION";

export const ENTERPRISE_CONTRACT_ACTIVE_ERROR_CODE =
  "ENTERPRISE_CONTRACT_ACTIVE";

export const betterAuthApiErrorSchema = z.object({
  status: z.string(),
  statusCode: z.number(),
  body: z.object({
    code: z.string(),
    message: z.string().nullish(),
  }),
});

export type BetterAuthApiErrorSchemaType = z.infer<
  typeof betterAuthApiErrorSchema
>;

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
