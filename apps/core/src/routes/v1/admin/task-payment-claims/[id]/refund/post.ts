import { createRoute } from "@hono/zod-openapi";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  adminTaskPaymentClaimActionResultSchema,
  adminTaskPaymentClaimIdParamSchema,
  refundAdminTaskPaymentClaimBodySchema,
} from "@/schemas/admin-task-payment-claim.schema";
import { refundReviewedTaskPaymentClaim } from "@/services/task-payment-claim.service";

const route = createRoute({
  method: "post",
  path: "/{id}/refund",
  operationId: "refundAdminTaskPaymentClaim",
  description:
    "Refund a reviewed task payment claim without parsing its stored purchase payload or contacting the payment node. Use only after confirming out of band that no live purchase exists (admin only).",
  tags: ["Admin"],
  request: {
    params: adminTaskPaymentClaimIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: refundAdminTaskPaymentClaimBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminTaskPaymentClaimActionResultSchema,
      "Task payment claim refund result",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict - claim is not available for review"),
    422: jsonErrorResponse("Unprocessable Entity - validation failed"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { reason } = c.req.valid("json");
    const operator = requireAdminAuthContext(c.var.authContext);
    const result = await refundReviewedTaskPaymentClaim({
      claimId: id,
      operatorId: operator.userId,
      reason,
    });
    if (result.status === "skipped") {
      throw conflict("Task payment claim is not available for review");
    }
    return ok(c, adminTaskPaymentClaimActionResultSchema.parse(result));
  });
}
