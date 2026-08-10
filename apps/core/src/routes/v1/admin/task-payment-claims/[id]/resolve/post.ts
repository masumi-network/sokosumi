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
import { resolveReviewedTaskPaymentClaim } from "@/services/task-payment-claim.service";

const route = createRoute({
  method: "post",
  path: "/{id}/resolve",
  operationId: "resolveAdminTaskPaymentClaim",
  description:
    "Resolve a reviewed claim without creating a new purchase: attach an existing purchase, refund authoritative absence/mismatch, or keep an ambiguous lookup held for review (admin only).",
  tags: ["Admin"],
  request: {
    params: adminTaskPaymentClaimIdParamSchema,
    body: {
      // Without this, @hono/zod-openapi skips body validation entirely when the
      // request carries no JSON content-type — the mandatory operator `reason`
      // would go unvalidated while the handler still mutates claim state.
      required: true,
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
      "Task payment claim resolution result",
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
    const result = await resolveReviewedTaskPaymentClaim({
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
