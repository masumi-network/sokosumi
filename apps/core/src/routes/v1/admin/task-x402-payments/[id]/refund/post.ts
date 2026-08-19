import { createRoute } from "@hono/zod-openapi";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireInteractiveAdminAuthContext } from "@/middleware/auth";
import {
  adminTaskX402PaymentIdParamSchema,
  refundAdminTaskX402PaymentBodySchema,
  refundAdminTaskX402PaymentResultSchema,
} from "@/schemas/admin-task-x402-payment.schema";
import { refundVerifiedTaskX402Payment } from "@/services/task-x402-payment.refund";

const route = createRoute({
  method: "post",
  path: "/{id}/refund",
  operationId: "refundAdminTaskX402Payment",
  description:
    "Goodwill / support-driven refund of a VERIFIED x402 payment (the paid-but-bad-result case, PR1-SPEC §5): flips it to REFUNDED, mints the compensating refund, and writes an operator audit row. Idempotent; only valid on a VERIFIED record — FAILED/REFUNDED are already compensated (409) and PENDING is left for coworker replay or operator resolution (409). Requires an interactive admin session.",
  tags: ["Admin"],
  request: {
    params: adminTaskX402PaymentIdParamSchema,
    body: {
      // Without this, @hono/zod-openapi skips body validation entirely when the
      // request carries no JSON content-type — the mandatory operator `reason`
      // would go unvalidated while the handler still mutates payment state.
      required: true,
      content: {
        "application/json": {
          schema: refundAdminTaskX402PaymentBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      refundAdminTaskX402PaymentResultSchema,
      "Task x402 payment refund result",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - payment does not exist"),
    409: jsonErrorResponse("Conflict - payment is not refundable"),
    422: jsonErrorResponse("Unprocessable Entity - validation failed"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { reason } = c.req.valid("json");
    const operator = requireInteractiveAdminAuthContext(c.var.authContext);
    const result = await refundVerifiedTaskX402Payment({
      paymentId: id,
      operatorId: operator.userId,
      reason,
    });
    if (result.status === "not_found") {
      throw notFound("Task x402 payment not found");
    }
    if (result.status === "already_refunded") {
      throw conflict("Task x402 payment has already been refunded");
    }
    if (result.status === "not_refundable") {
      throw conflict(result.reason);
    }
    return ok(c, refundAdminTaskX402PaymentResultSchema.parse(result));
  });
}
