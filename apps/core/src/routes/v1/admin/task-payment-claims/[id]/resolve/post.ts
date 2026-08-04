import { createRoute } from "@hono/zod-openapi";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminTaskPaymentClaimActionResultSchema,
  adminTaskPaymentClaimIdParamSchema,
} from "@/schemas/admin-task-payment-claim.schema";
import { resolveReviewedTaskPaymentClaim } from "@/services/task-payment-claim.service";

const route = createRoute({
  method: "post",
  path: "/{id}/resolve",
  operationId: "resolveAdminTaskPaymentClaim",
  description:
    "Resolve a reviewed claim without creating a new purchase: attach an existing purchase, refund authoritative absence/mismatch, or keep an ambiguous lookup held for review (admin only).",
  tags: ["Admin"],
  request: { params: adminTaskPaymentClaimIdParamSchema },
  responses: {
    200: jsonSuccessResponse(
      adminTaskPaymentClaimActionResultSchema,
      "Task payment claim resolution result",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict - claim is not available for review"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const result = await resolveReviewedTaskPaymentClaim(id);
    if (result.status === "skipped") {
      throw conflict("Task payment claim is not available for review");
    }
    return ok(c, adminTaskPaymentClaimActionResultSchema.parse(result));
  });
}
