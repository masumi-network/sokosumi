import { createRoute } from "@hono/zod-openapi";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  adminTaskPaymentClaimActionResultSchema,
  adminTaskPaymentClaimIdParamSchema,
  reviewedTaskPaymentClaimActionBodySchema,
} from "@/schemas/admin-task-payment-claim.schema";
import { retryReviewedTaskPaymentClaim } from "@/services/task-payment-claim.service";

const route = createRoute({
  method: "post",
  path: "/{id}/retry",
  operationId: "retryAdminTaskPaymentClaim",
  description:
    "Move a reviewed task payment claim back to the normal retry queue (admin only).",
  tags: ["Admin"],
  request: {
    params: adminTaskPaymentClaimIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: reviewedTaskPaymentClaimActionBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminTaskPaymentClaimActionResultSchema,
      "Task payment claim retry scheduled",
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
    if (
      !(await retryReviewedTaskPaymentClaim({
        claimId: id,
        operatorId: operator.userId,
        reason,
      }))
    ) {
      throw conflict("Task payment claim is not available for review");
    }
    return ok(
      c,
      adminTaskPaymentClaimActionResultSchema.parse({
        status: "retry_scheduled",
        reason,
      }),
    );
  });
}
