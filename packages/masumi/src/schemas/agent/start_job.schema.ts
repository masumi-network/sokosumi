import * as z from "zod";

import { inputSchema } from "../input/input.schema.js";

export const startJobRequestSchema = z.object({
  identifierFromPurchaser: z.string(),
  input_data: inputSchema,
});

export type StartJobRequestSchemaType = z.infer<typeof startJobRequestSchema>;

function preprocessStartJobResponse(val: unknown): unknown {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const { job_id, ...rest } = obj;
    return {
      ...rest,
      id: obj.id ?? job_id,
    };
  }
  return val;
}

export const startFreeJobResponseSchema = z.preprocess(
  preprocessStartJobResponse,
  z.object({
    id: z.string().min(1),
  }),
);

export type StartFreeJobResponseSchemaType = z.infer<
  typeof startFreeJobResponseSchema
>;

export const startPaidJobResponseSchema = z.preprocess(
  preprocessStartJobResponse,
  z.object({
    id: z.string().min(1),
    input_hash: z.string().min(1),
    identifierFromPurchaser: z.string().min(1),
    blockchainIdentifier: z.string().min(1),
    // UNBOUNDED ON PURPOSE — but the absence of a maximum is load-bearing, so
    // it is written down rather than left to be rediscovered.
    //
    // `payByTime` is chosen by the seller and is the sole gate on the local
    // credit refund: buildJobsPendingLocalRefundWhere (packages/database/src/
    // helpers/job-sync.ts) only refunds a purchase-less job once
    // `payByTime < now - JOB_SYNC_PAYMENT_GRACE_MS`. A seller returning a
    // far-future value — year 9999 is a valid int — alongside a
    // blockchainIdentifier the payment node rejects leaves the buyer debited
    // with no purchase and no refund, indefinitely.
    //
    // A sane bound is the protocol's own: the four deadlines must be ordered
    // (payByTime <= submitResultTime <= unlockTime <=
    // externalDisputeUnlockTime) and payByTime should be within days of now,
    // not years. Enforcing that is a change to the V1 hire path and belongs
    // with the seller-trust work (sellerVkey is unverified on the same
    // response), not here.
    payByTime: z.coerce.number().int(),
    submitResultTime: z.coerce.number().int(),
    unlockTime: z.coerce.number().int(),
    externalDisputeUnlockTime: z.coerce.number().int(),
    agentIdentifier: z.string().min(1),
    sellerVKey: z.string().min(1),
    // The full vocabulary the protocol defines for this field, not just the
    // two Cardano rails. An x402/EVM source reports `null` (payment spec:
    // `paymentSourceType` is nullable on the EVM branch) and a registry entry
    // with no on-chain rail reports `"None"` — both mean "no Cardano source
    // selected", so both normalize to absent.
    //
    // Values outside the vocabulary still fail on purpose. What must NOT
    // happen is failing on a LEGAL one: a start_job response that does not
    // parse is reported as `invalid-response`, and by then the seller has
    // already accepted the job. MIP-003 has no cancel, so rejecting a legal
    // value here strands real work.
    paymentSourceType: z.preprocess(
      (value) => (value === null || value === "None" ? undefined : value),
      z.enum(["Web3CardanoV1", "Web3CardanoV2"]).optional(),
    ),
    // Coerced like the sibling time fields — sellers serialize
    // inconsistently — but only genuine numbers and numeric strings count
    // as a selection. Absent-intent junk (null, "", false, []) must never
    // coerce into index 0 via Number() semantics.
    //
    // Out-of-range / non-integer / NaN also normalize to absent rather than
    // failing the whole start_job parse. By parse time the seller has already
    // accepted the job (same stranding risk as paymentSourceType above); a
    // missing source index degrades to default selection, while a parse
    // failure is reported as invalid-response with no MIP-003 cancel.
    supportedPaymentSourceIndex: z.preprocess((value) => {
      let candidate: number | undefined;
      if (typeof value === "number") {
        candidate = value;
      } else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
        candidate = Number(value.trim());
      } else {
        return undefined;
      }
      if (
        !Number.isInteger(candidate) ||
        Number.isNaN(candidate) ||
        candidate < 0 ||
        candidate > 24
      ) {
        return undefined;
      }
      return candidate;
    }, z.number().int().min(0).max(24).optional()),
  }),
);

export type StartPaidJobResponseSchemaType = z.infer<
  typeof startPaidJobResponseSchema
>;
