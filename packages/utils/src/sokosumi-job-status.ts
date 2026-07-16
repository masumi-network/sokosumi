/**
 * Sōkosumi-facing job statuses derived from on-chain and agent state.
 *
 * Used by `@sokosumi/database` helpers and Core OpenAPI seeding — not a
 * Prisma enum. Web runtime types come from OpenAPI/codegen; this const map
 * remains for Core + DB layers that need stable string values without
 * importing generated Prisma client types at the package boundary.
 */
export const SokosumiJobStatus = {
  STARTED: "started",
  COMPLETED: "completed",
  PROCESSING: "processing",
  INPUT_REQUIRED: "input_required",
  RESULT_PENDING: "result_pending",
  FAILED: "failed",

  PAYMENT_PENDING: "payment_pending",
  PAYMENT_FAILED: "payment_failed",

  REFUND_PENDING: "refund_pending",
  REFUND_RESOLVED: "refund_resolved",

  DISPUTE_PENDING: "dispute_pending",
  DISPUTE_RESOLVED: "dispute_resolved",
} as const;

export type SokosumiJobStatus =
  (typeof SokosumiJobStatus)[keyof typeof SokosumiJobStatus];
