import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

export const adminTaskPaymentClaimListQuerySchema = z
  .object({})
  .extend(cursorPaginationQuerySchema.shape);

export const adminTaskPaymentClaimIdParamSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Task payment claim ID",
    example: "0198aabc-1234-7000-8000-000000000001",
  }),
});

export const refundAdminTaskPaymentClaimBodySchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .openapi("RefundAdminTaskPaymentClaimBody");

/**
 * Resolve and retry also change money or recovery state, so they carry the
 * same mandatory operator reason as refund — it is written to the append-only
 * claim-action audit trail.
 */
export const reviewedTaskPaymentClaimActionBodySchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .openapi("ReviewedTaskPaymentClaimActionBody");

export const adminTaskPaymentClaimSchema = z
  .object({
    id: z.string(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    network: z.enum(["Preprod", "Mainnet"]),
    blockchainIdentifier: z.string(),
    failureReason: z.string().nullable(),
    attemptCount: z.number().int().nonnegative(),
    lastAttemptAt: dateTimeSchema.nullable(),
    nextAttemptAt: dateTimeSchema,
    reviewRequiredAt: dateTimeSchema,
    taskEventId: z.string().nullable(),
    transactionId: z.string(),
    user: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
    }),
  })
  .openapi("AdminTaskPaymentClaim");

export const adminTaskPaymentClaimListSchema = z.array(
  adminTaskPaymentClaimSchema,
);

export const adminTaskPaymentClaimActionResultSchema = z
  .discriminatedUnion("status", [
    z.object({ status: z.literal("purchased"), purchaseId: z.string() }),
    z.object({
      status: z.literal("refunded"),
      reason: z.string(),
      compensated: z.boolean(),
    }),
    z.object({ status: z.literal("retry_scheduled"), reason: z.string() }),
    z.object({ status: z.literal("review_required"), reason: z.string() }),
  ])
  .openapi("AdminTaskPaymentClaimActionResult");
