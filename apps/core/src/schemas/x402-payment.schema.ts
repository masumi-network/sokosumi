import { z } from "@hono/zod-openapi";

import type { X402PaymentHeaderDescriptor } from "@/helpers/x402-settlement";

/**
 * Request/response shapes for the coworker x402 pay endpoint
 * (`POST /v1/tasks/{taskId}/x402-payments`, PR1-SPEC §3).
 */

/**
 * `idempotencyKey` is bounded because it sits inside the
 * `[taskId, idempotencyKey]` btree unique: an unbounded coworker-supplied key
 * can exceed the btree row limit at INSERT time — a runtime 500 (the charge
 * rolls back, no money lost) where a 422 belongs. 200 mirrors the
 * identifierFromPurchaser-style bounds (step-2 review follow-up).
 *
 * Leading/trailing whitespace is REJECTED (not trimmed): `"key"` and `"key\n"`
 * are distinct btree slots, so a padded duplicate of a live key would mint a
 * SECOND charge for the same 402. Rejecting makes the coworker send the exact
 * key back, keeping the dedupe unique honest.
 */
export const createTaskX402PaymentRequestSchema = z.object({
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value === value.trim() && value.trim().length > 0, {
      message:
        "idempotencyKey must not be blank or have surrounding whitespace",
    })
    .openapi({
      example: "job-7f3a-attempt-1",
      description:
        "Coworker-supplied key, unique per payment intent within the task. Replaying the same key never charges twice — a completed payment returns its stored header; only an attempt whose sign outcome is still unknown is re-signed. Leading/trailing whitespace is rejected.",
    }),
  agentId: z.string().min(1).openapi({
    example: "cmaeygqwa000e8i0s9s7wif8i",
    description:
      "The listed x402 agent this 402 came from (GET /v1/agents?kind=x402)",
  }),
  paymentRequired: z
    .unknown()
    .refine((value) => value !== undefined && value !== null, {
      message: "paymentRequired is required",
    })
    .openapi({
      description:
        "The agent's 402 response, verbatim: either dialect JSON body or the base64 PAYMENT-REQUIRED header transport string",
    }),
  /**
   * The caller's own ceiling on this payment, checked BEFORE any debit.
   *
   * In credits, not token base units, for two reasons: credits are what is
   * actually spent out of the task owner's balance, and base units are
   * per-asset — a 402 offering a different asset would slip straight past a
   * base-unit cap. It also matches the existing `maxCredits` on the job-hire
   * request, so an integrator learns one unit for both spend fences.
   *
   * Required for DYNAMIC registry pricing, where the 402 is the only quote.
   * Why it exists for every pricing mode: the 402 is authored by the agent being paid, and the
   * matcher takes the first `accepts` entry matching any registered payment
   * source. An agent with two registered sources can therefore order its
   * `accepts` expensive-first and be paid the expensive one — every entry
   * still passing `demanded <= advertised`, because each is checked against
   * its own source row. Nothing else in the flow knows which resource the
   * caller meant to buy.
   */
  maxCredits: z.number().positive().finite().optional().openapi({
    example: 2,
    description:
      "Maximum credits this payment may cost. Required for dynamically priced agents; optional but strongly recommended for fixed pricing. The runtime 402 demand is compared against it before any debit.",
  }),
});

export type CreateTaskX402PaymentRequest = z.infer<
  typeof createTaskX402PaymentRequestSchema
>;

const taskX402PaymentHeaderSchema = z.object({
  x402Version: z.union([z.literal(1), z.literal(2)]),
  name: z.enum(["X-PAYMENT", "PAYMENT-SIGNATURE"]),
  value: z.string(),
});

type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;
/**
 * Compile-time bind between the response schema and the settlement helper's
 * `X402PaymentHeaderDescriptor`. The route parses the descriptor the
 * finalize/replay path produced through this schema
 * (`taskX402PaymentSignedSchema.parse(result.payment)`), so a descriptor
 * variant this schema cannot parse — a new protocol version, a renamed
 * header — would 500 a successfully signed payment AFTER the charge. The
 * bidirectional assignability pin turns that drift into a typecheck failure
 * here instead.
 *
 * KNOWN LIMIT: a new OPTIONAL descriptor field does NOT trip the pin —
 * optional properties block neither direction of assignability — so
 * `.parse` would silently strip it from responses. Whoever adds an optional
 * field to `X402PaymentHeaderDescriptor` must extend this schema by hand.
 */
const _headerSchemaMatchesDescriptor: MutuallyAssignable<
  z.infer<typeof taskX402PaymentHeaderSchema>,
  X402PaymentHeaderDescriptor
> = true;

/** Protocol-aware replay header plus Soko's payment record id. */
export const taskX402PaymentSignedSchema = z
  .object({
    paymentId: z.string().openapi({
      example: "0198b2f4-1111-7000-8000-000000000000",
      description:
        "Sokosumi payment-record id (support, admin refund, status lookups)",
    }),
    attemptId: z.string().openapi({
      example: "attempt_1",
      description: "Payment-node attempt id",
    }),
    paymentHeader: taskX402PaymentHeaderSchema.openapi({
      description:
        "Protocol-normalized replay header. Send value under name exactly as returned: X-PAYMENT for v1, PAYMENT-SIGNATURE for v2.",
    }),
    caip2Network: z.string().openapi({ example: "eip155:84532" }),
    asset: z.string().openapi({
      example: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      description: "ERC-20 contract address of the signed asset",
    }),
    amount: z.string().openapi({
      example: "250000",
      description: "Signed amount in token base units",
    }),
    payTo: z.string().openapi({
      example: "0x1111111111111111111111111111111111111111",
    }),
  })
  .openapi("TaskX402PaymentSigned");

export type TaskX402PaymentSigned = z.infer<typeof taskX402PaymentSignedSchema>;
