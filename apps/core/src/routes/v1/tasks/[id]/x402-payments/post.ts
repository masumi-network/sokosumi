import { createRoute, z } from "@hono/zod-openapi";
import { X402_MAX_ENCODED_PAYLOAD_LENGTH } from "@sokosumi/masumi/schemas";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { bodyLimit } from "hono/body-limit";

import {
  errorResponseWithExtensionsSchema,
  payloadTooLarge,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok, unprocessableWithData } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  createTaskX402PaymentRequestSchema,
  taskX402PaymentSignedSchema,
} from "@/schemas/x402-payment.schema";
import { payTaskX402 } from "@/services/task-x402-payment.service";

/**
 * Ceiling on the whole request body — the companion bound that
 * `X402_MAX_ENCODED_PAYLOAD_LENGTH` names.
 *
 * That constant bounds the base64 `PAYMENT-REQUIRED` HEADER dialect only. The
 * v1 JSON-BODY dialect "inherits whatever limit the route sets", and this
 * route set none: `paymentRequired` is typed `z.unknown()`, so Hono parsed the
 * entire body and `stripPrototypePollutingKeys` walked it in full before any
 * per-field cap in the masumi limits could apply. Vercel's 4.5 MB platform
 * limit capped the production blast radius; a self-hosted `@hono/node-server`
 * has no such backstop.
 *
 * Deliberately the SAME number rather than a derived one. Base64 inflates by
 * 4/3, so 256 KiB of raw JSON body is strictly more permissive than 256 KiB of
 * base64 header, and the masumi doc records that everything the per-field
 * bounds accept fits inside roughly 172 KiB of JSON. Keeping one number means
 * the pair cannot silently drift: raising or removing either without the other
 * reopens the header/body asymmetry both exist to close.
 */
export const X402_PAY_MAX_BODY_BYTES = X402_MAX_ENCODED_PAYLOAD_LENGTH;

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/x402-payments",
  description:
    "Pay a 402 returned by a listed x402 agent. Requires a direct coworker API key without X-Context-* headers, the tasks capability, and a non-DRAFT, non-parked task assigned to that coworker. Verifies the demand, charges task credits, signs through the payment node, and returns `paymentHeader`, whose name is X-PAYMENT for v1 or PAYMENT-SIGNATURE for v2. Fixed pricing verifies the runtime demand against the registered ceiling. Dynamic pricing treats the runtime 402 as the quote and requires `maxCredits`. Replaying the same idempotencyKey never charges twice: a completed payment returns its stored header, and only an attempt whose sign outcome is still unknown is retried at the node.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: createTaskX402PaymentRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      taskX402PaymentSignedSchema,
      "The signed x402 payment (fresh or idempotent replay)",
    ),
    400: jsonErrorResponse(
      "Bad Request. A fresh dynamic quote requires maxCredits, or the priced demand exceeds the supplied maxCredits. Nothing was charged and the idempotencyKey is not consumed; supply or raise the cap and retry with the SAME key.",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden. The caller is not a direct coworker, lacks task capability/assignment, or the task is parked awaiting workspace access.",
    ),
    404: jsonErrorResponse(
      "Not Found. The task is absent, archived, inaccessible, or DRAFT; inaccessible task state is intentionally not disclosed.",
    ),
    409: jsonErrorResponse(
      "Conflict. Branch on `kind`: x402_payment_key_consumed (terminal payment, charge already refunded — use a new key), x402_payment_key_reused (same key, different agent/demand — use a new key), x402_payment_key_in_flight (concurrent request holds the sign — retry the SAME key), x402_payment_header_expired (the stored authorization expired or has too little life left to deliver; the charge stands, nothing was refunded — a new key is a new payment intent), x402_payment_sign_attempts_exhausted (contact support; do NOT retry or use a new key — earlier ambiguous attempts may hold a live authorization), x402_payment_demand_unbound (pre-fingerprint record — contact support, never mint a new key), concurrency_conflict (serializable-transaction contention — retry the SAME request unchanged).",
    ),
    413: jsonErrorResponse("Payload Too Large"),
    422: {
      description:
        "Unprocessable Entity. Branch on `kind`: absent (verification failed before any charge — nothing charged, key not consumed), insufficient_balance (mid-run balance shortfall paused the task to OUT_OF_CREDITS; nothing charged), or x402_pay_refused (the node deterministically rejected the forwarded 402 with status 400 AFTER the charge — the charge was refunded and the idempotencyKey is consumed; re-fetch the 402 and use a NEW key).",
      content: {
        "application/json": {
          schema: errorResponseWithExtensionsSchema({
            data: z.null().optional(),
            attemptedCredits: z.number().optional().openapi({ example: 2 }),
          }),
        },
      },
    },
    500: jsonErrorResponse("Internal Server Error"),
    502: jsonErrorResponse(
      "Bad Gateway. Branch on `kind`: x402_pay_refused (node operational refusal — credits refunded, use a new idempotencyKey), x402_pay_outcome_unknown (sign outcome unknown or refund incomplete — charge held on the pending record, retry with the SAME idempotencyKey; a new key would charge twice), or x402_pay_pending_held (current catalog state blocks re-signing the held charge: agent unlisted, demand no longer verifying, or pair not buy-side ready — retry the SAME key later or contact support; a new key would charge twice).",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.use(
    "/:id/x402-payments",
    bodyLimit({
      maxSize: X402_PAY_MAX_BODY_BYTES,
      onError: () => {
        throw payloadTooLarge(
          `Request body is too large. Maximum size is ${X402_PAY_MAX_BODY_BYTES} bytes.`,
        );
      },
    }),
  );

  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id: taskId } = c.req.valid("param");
    const body = c.req.valid("json");

    const result = await payTaskX402({
      authContext,
      taskId,
      idempotencyKey: body.idempotencyKey,
      agentId: body.agentId,
      paymentRequired: body.paymentRequired,
      maxCredits: body.maxCredits,
    });

    if (result.outcome === "out_of_credits") {
      // Charge failed but the OUT_OF_CREDITS pause was committed — not what
      // the requester asked for, so 422 (mirrors the task-events route).
      return unprocessableWithData(c, null, {
        message: "Insufficient balance",
        kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
        attemptedCredits: result.attemptedCredits,
      });
    }

    return ok(c, taskX402PaymentSignedSchema.parse(result.payment));
  });
}
