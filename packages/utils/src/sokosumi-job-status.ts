/**
 * Sōkosumi-facing job statuses derived from on-chain and agent state.
 *
 * Client-safe single source of truth, re-used by `@sokosumi/database`,
 * `apps/core`, and `apps/web`. Previously a TS enum in `@sokosumi/database`;
 * moved here as a const map (per the repo convention to avoid enums) so
 * consumers can reference these values without pulling in
 * `@sokosumi/database`.
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
