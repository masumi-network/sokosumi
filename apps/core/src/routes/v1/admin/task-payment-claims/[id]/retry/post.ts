import { createRoute } from "@hono/zod-openapi";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminTaskPaymentClaimActionResultSchema,
  adminTaskPaymentClaimIdParamSchema,
} from "@/schemas/admin-task-payment-claim.schema";
import { retryReviewedTaskPaymentClaim } from "@/services/task-payment-claim.service";

const route = createRoute({
  method: "post",
  path: "/{id}/retry",
  operationId: "retryAdminTaskPaymentClaim",
  description:
    "Move a reviewed task payment claim back to the normal retry queue (admin only).",
  tags: ["Admin"],
  request: { params: adminTaskPaymentClaimIdParamSchema },
  responses: {
    200: jsonSuccessResponse(
      adminTaskPaymentClaimActionResultSchema,
      "Task payment claim retry scheduled",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict - claim is not available for review"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    if (!(await retryReviewedTaskPaymentClaim(id))) {
      throw conflict("Task payment claim is not available for review");
    }
    return ok(
      c,
      adminTaskPaymentClaimActionResultSchema.parse({
        status: "retry_scheduled",
        reason: "Administrator requested a fresh resolve-first retry",
      }),
    );
  });
}
