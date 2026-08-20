import { createRoute } from "@hono/zod-openapi";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireInteractiveAdminAuthContext } from "@/middleware/auth";
import {
  adminTaskX402PaymentIdParamSchema,
  resolveAdminTaskX402PaymentBodySchema,
  resolveAdminTaskX402PaymentResultSchema,
} from "@/schemas/admin-task-x402-payment.schema";
import { resolvePendingTaskX402Payment } from "@/services/task-x402-payment.refund";

const route = createRoute({
  method: "post",
  path: "/{id}/resolve",
  operationId: "resolveAdminTaskX402Payment",
  description:
    "Support resolution of a WEDGED PENDING x402 payment: flips it to REFUNDED, mints the compensating refund, and writes an operator audit row. PENDING only. Resolution is refused while either the sign lease is active or signRiskExpiresAt says a discarded authorization may still be live; the 409 identifies when to retry. VERIFIED is refused because its header may still settle, and only the goodwill refund may reverse it. Idempotent; FAILED/REFUNDED are already compensated (409). Requires an interactive admin session.",
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
          schema: resolveAdminTaskX402PaymentBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      resolveAdminTaskX402PaymentResultSchema,
      "Task x402 payment resolution result",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - payment does not exist"),
    409: jsonErrorResponse("Conflict - payment is not resolvable"),
    422: jsonErrorResponse("Unprocessable Entity - validation failed"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { reason } = c.req.valid("json");
    const operator = requireInteractiveAdminAuthContext(c.var.authContext);
    const result = await resolvePendingTaskX402Payment({
      paymentId: id,
      operatorId: operator.userId,
      reason,
    });
    if (result.status === "not_found") {
      throw notFound("Task x402 payment not found");
    }
    if (result.status === "already_resolved") {
      throw conflict("Task x402 payment has already been compensated", {
        kind: "already_resolved",
      });
    }
    if (
      result.status === "sign_in_flight" ||
      result.status === "sign_outcome_unresolved"
    ) {
      throw conflict(result.reason, {
        kind: result.status,
        extensions: {
          retryAfter: result.retryAfter,
          retryAfterSeconds: result.retryAfterSeconds,
        },
      });
    }
    if (result.status === "not_resolvable") {
      throw conflict(result.reason, { kind: result.status });
    }
    return ok(c, resolveAdminTaskX402PaymentResultSchema.parse(result));
  });
}
