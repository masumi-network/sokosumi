import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { startCmoOver } from "@/services/cmo-hiring.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/start-over",
  operationId: "startCmoOverForProject",
  tags: ["CMO"],
  description:
    "Archives the Project's Cuso and cancels his unsent posts, so the caller can hire Cuso for another website. A subscribed Cuso's CMO subscription ends first, at once and without a refund, and his Project credits are written off.",
  request: { params: cmoProjectParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      z.object({ startedOver: z.literal(true) }),
      "Cuso is archived; CMO decides where to go next",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Only an organization owner or admin can"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    503: jsonErrorResponse(
      "His subscription could not be ended at Polar; nothing was changed",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    await startCmoOver({ userId, projectId }).catch(rethrow);
    return ok(c, { startedOver: true as const });
  });
}
