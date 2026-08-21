import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { errorResponseWithExtensionsSchema } from "@/helpers/error";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

/**
 * Admin observability + goodwill-refund surface for x402 payments
 * (PR1-SPEC §5). Mirrors the admin task-payment-claims schema shape.
 *
 * SECURITY: `xPaymentHeader` is a bearer instrument — a signed X-PAYMENT
 * authorization anyone can replay to move the buyer's funds until
 * `validBefore` passes (step-5 review, finding 7). It is intentionally absent
 * from every schema here, and the routes select columns explicitly so it can
 * never reach a support/admin surface. The raw signed-payload observation
 * fields (`payerAddress`, `payloadNonce`, `paymentPayloadHash`) are also
 * omitted — they belong to the future reconciler, not the dashboard.
 */

const TASK_X402_PAYMENT_STATUS = [
  "PENDING",
  "VERIFIED",
  "FAILED",
  "REFUNDED",
] as const;

/**
 * Bounds for the operator-supplied filter strings. There is no injection to
 * stop here — Prisma parameterises and every one of these is an equality
 * filter — but an unbounded string has no business reaching the query, and a
 * bogus value should fail at the edge rather than come back as a silently empty
 * page. `caip2Network` matches its column (`@db.VarChar(64)`); the id bound is
 * generous against a uuid(7) (36 chars) without being open-ended.
 */
const MAX_CAIP2_NETWORK_LENGTH = 64;
const MAX_ID_FILTER_LENGTH = 128;

const TASK_X402_PAYMENT_REFUND_REASONS = [
  "agent_output_quality",
  "duplicate_charge",
  "support_adjustment",
] as const;

const TASK_X402_PAYMENT_RESOLVE_REASONS = [
  "account_deletion_blocked",
  "node_unreachable",
  "sign_attempts_exhausted",
  "unsettleable_authorization",
] as const;

/** Mirrors the Prisma `TaskX402PaymentRefundKind` enum. */
const TASK_X402_PAYMENT_REFUND_KIND = [
  "NODE_REFUSAL",
  "OPERATOR_GOODWILL",
  "OPERATOR_RESOLVE",
] as const;

export const adminTaskX402PaymentListQuerySchema = z
  .object({
    status: z
      .enum(TASK_X402_PAYMENT_STATUS)
      .optional()
      .openapi({
        param: { name: "status", in: "query" },
        description: "Filter by payment status",
        example: "VERIFIED",
      }),
    agentId: z
      .string()
      .trim()
      .min(1)
      .max(MAX_ID_FILTER_LENGTH)
      .optional()
      .openapi({
        param: { name: "agentId", in: "query" },
        description: "Filter by the charged agent (aggregation key)",
      }),
    caip2Network: z
      .string()
      .trim()
      .min(1)
      .max(MAX_CAIP2_NETWORK_LENGTH)
      .optional()
      .openapi({
        param: { name: "caip2Network", in: "query" },
        description: "Filter by CAIP-2 network id (e.g. eip155:84532)",
        example: "eip155:84532",
      }),
  })
  .extend(cursorPaginationQuerySchema.shape);

export const adminTaskX402PaymentIdParamSchema = z.object({
  id: z
    .string()
    .max(MAX_ID_FILTER_LENGTH)
    .openapi({
      param: { name: "id", in: "path" },
      description: "Task x402 payment ID",
      example: "0198b2f4-1111-7000-8000-000000000000",
    }),
});

export const refundAdminTaskX402PaymentBodySchema = z
  .object({
    reason: z.enum(TASK_X402_PAYMENT_REFUND_REASONS).openapi({
      description:
        "Coded refund rationale. Narrative text and personal data are not accepted because the audit row survives account deletion.",
      example: "agent_output_quality",
    }),
  })
  .openapi("RefundAdminTaskX402PaymentBody");

export const resolveAdminTaskX402PaymentBodySchema = z
  .object({
    reason: z.enum(TASK_X402_PAYMENT_RESOLVE_REASONS).openapi({
      description:
        "Coded resolution rationale. Narrative text and personal data are not accepted because the audit row survives account deletion.",
      example: "sign_attempts_exhausted",
    }),
  })
  .openapi("ResolveAdminTaskX402PaymentBody");

export type RefundAdminTaskX402PaymentBody = z.infer<
  typeof refundAdminTaskX402PaymentBodySchema
>;

export type ResolveAdminTaskX402PaymentBody = z.infer<
  typeof resolveAdminTaskX402PaymentBodySchema
>;

/**
 * A single x402 payment row for the admin list. `xPaymentHeader` is
 * deliberately absent (bearer instrument); `amount` is the chain-native
 * base-unit demand, `creditsCharged` is the debited credit count.
 */
export const adminTaskX402PaymentSchema = z
  .object({
    id: z.string(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    status: z.enum(TASK_X402_PAYMENT_STATUS),
    taskId: z.string(),
    agentId: z.string(),
    caip2Network: z.string(),
    asset: z.string(),
    amount: z.string().openapi({
      description: "Demanded amount in token base units",
      example: "250000",
    }),
    payTo: z.string(),
    creditsCharged: z.number().nonnegative().openapi({
      description: "Credits debited from the task org for this payment",
      example: 3,
    }),
    failureReason: z.string().nullable(),
    attemptId: z.string().nullable(),
    signAttemptCount: z.number().int().nonnegative(),
    signRiskExpiresAt: dateTimeSchema.nullable().openapi({
      description:
        "Do not resolve a PENDING payment before this instant: an unseen authorization from its last sign attempt may still be live",
    }),
    validBefore: dateTimeSchema.nullable().openapi({
      description: "EIP-3009 authorization expiry, present once signed",
    }),
    taskEventId: z.string().nullable(),
    transactionId: z.string(),
    refundTransactionId: z.string().nullable().openapi({
      description:
        "The compensating refund transaction, if the payment was refunded",
    }),
    refundKind: z.enum(TASK_X402_PAYMENT_REFUND_KIND).nullable().openapi({
      description:
        "Which lever minted the refund: NODE_REFUSAL (automated, row stays FAILED), OPERATOR_GOODWILL (VERIFIED → REFUNDED), or OPERATOR_RESOLVE (wedged PENDING → REFUNDED). Null when no refund was minted. Without it a REFUNDED row cannot be told apart from a goodwill refund on this surface either.",
    }),
  })
  .openapi("AdminTaskX402Payment");

export const adminTaskX402PaymentListSchema = z.array(
  adminTaskX402PaymentSchema,
);

export const refundAdminTaskX402PaymentResultSchema = z
  .object({
    status: z.literal("refunded"),
    paymentId: z.string(),
    reason: z.string(),
    compensated: z.boolean(),
  })
  .openapi("RefundAdminTaskX402PaymentResult");

export const refundAdminTaskX402PaymentConflictSchema =
  errorResponseWithExtensionsSchema(
    {
      kind: z.enum(["already_refunded", "not_refundable"]).optional().openapi({
        description:
          "already_refunded is the idempotent guard. not_refundable covers PENDING (use resolve) and any other non-VERIFIED row.",
      }),
    },
    "AdminTaskX402RefundConflictResponse",
  );

export const resolveAdminTaskX402PaymentResultSchema = z
  .object({
    status: z.literal("resolved"),
    paymentId: z.string(),
    reason: z.string(),
    compensated: z.boolean(),
  })
  .openapi("ResolveAdminTaskX402PaymentResult");

/**
 * Resolve 409 envelope. `retryAfter` / `retryAfterSeconds` are present when
 * `kind` is `sign_in_flight` or `sign_outcome_unresolved`; omitted for
 * `already_resolved` / `not_resolvable`.
 */
export const resolveAdminTaskX402PaymentConflictSchema =
  errorResponseWithExtensionsSchema(
    {
      kind: z
        .enum([
          "already_resolved",
          "sign_in_flight",
          "sign_outcome_unresolved",
          "not_resolvable",
        ])
        .optional()
        .openapi({
          description:
            "sign_in_flight and sign_outcome_unresolved include retryAfter and retryAfterSeconds",
        }),
      retryAfter: dateTimeSchema.optional().openapi({
        description:
          "ISO instant after which the operator can retry resolve. Present with sign_in_flight and sign_outcome_unresolved.",
        example: "2026-08-12T10:00:30.000Z",
      }),
      retryAfterSeconds: z.number().int().nonnegative().optional().openapi({
        description: "Whole seconds until retryAfter. Present with retryAfter.",
        example: 25,
      }),
    },
    "AdminTaskX402ResolveConflictResponse",
  );

export const adminTaskX402PaymentAggregateQuerySchema = z.object({
  status: z
    .enum(TASK_X402_PAYMENT_STATUS)
    .optional()
    .openapi({
      param: { name: "status", in: "query" },
      description: "Restrict the rollup to one payment status",
      example: "PENDING",
    }),
  agentId: z
    .string()
    .trim()
    .min(1)
    .max(MAX_ID_FILTER_LENGTH)
    .optional()
    .openapi({
      param: { name: "agentId", in: "query" },
      description: "Restrict the rollup to a single agent",
    }),
  caip2Network: z
    .string()
    .trim()
    .min(1)
    .max(MAX_CAIP2_NETWORK_LENGTH)
    .optional()
    .openapi({
      param: { name: "caip2Network", in: "query" },
      description: "Restrict the rollup to a single CAIP-2 network id",
      example: "eip155:84532",
    }),
});

/**
 * Per-agent/registration rollup grouped by `agentId` (PR1-SPEC §5). Lifecycle
 * totals come from retained payments; quality/operational outcome counters
 * come from the FK-free ledger and survive terminal-payment deletion.
 *
 * `goodwillRefundCount` is the headline quality signal and primary sort key:
 * the count of durable `action: refund` outcomes from the VERIFIED → REFUNDED
 * admin lever, "we charged for a bad result". It is not derived from current
 * `status === REFUNDED`, because three levers refund and deletion removes the
 * source payment:
 *
 *   - automated node-refusal refunds stay FAILED (`NODE_REFUSAL`) — user-safe,
 *     node-budget-only, already counted by `failureCount`;
 *   - operator resolves of wedged PENDING charges land REFUNDED
 *     (`OPERATOR_RESOLVE`) and are reported separately as
 *     `operatorResolveCount`. Counting them here would let ambiguous 200s and
 *     node timeouts — or a hostile coworker deliberately wedging PENDING rows
 *     against a competitor's agent — rank a healthy endpoint worst.
 *
 * `refunded` counts only retained REFUNDED rows. Durable counters can exceed
 * it after account deletion; that difference is intentional.
 *
 * `failureCount` is the durable count of node-refusal outcomes — the secondary
 * signal. A bleeding agent registration is the one an operator disables.
 */
export const adminTaskX402PaymentAgentAggregateSchema = z
  .object({
    agentId: z.string(),
    total: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    refunded: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative().openapi({
      description:
        "Durable count of node-refused failures — the §5 secondary signal; survives terminal-payment deletion",
    }),
    goodwillRefundCount: z.number().int().nonnegative().openapi({
      description:
        "Durable count of operator goodwill refunds (VERIFIED → REFUNDED) — the §5 primary quality signal and sort key; survives terminal-payment deletion",
    }),
    operatorResolveCount: z.number().int().nonnegative().openapi({
      description:
        "Durable count of operator resolves of wedged PENDING charges. Visible but excluded from quality ranking; survives terminal-payment deletion.",
    }),
  })
  .openapi("AdminTaskX402PaymentAgentAggregate");

export const adminTaskX402PaymentAggregateSchema = z.array(
  adminTaskX402PaymentAgentAggregateSchema,
);
