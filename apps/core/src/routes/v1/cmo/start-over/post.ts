import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { startCmoOver } from "@/services/cmo-hiring.service";

import { rethrow } from "../helpers";

const route = createRoute({
  method: "post",
  path: "/start-over",
  operationId: "startCmoOver",
  tags: ["CMO"],
  description:
    "Archives the Cuso the caller works with and cancels his unsent posts, so they can hire Cuso for another website.",
  responses: {
    200: jsonSuccessResponse(
      z.object({ startedOver: z.literal(true) }),
      "Cuso is archived",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Only an organization owner or admin can"),
    404: jsonErrorResponse("Cuso is not hired yet"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    await startCmoOver(userId).catch(rethrow);
    return ok(c, { startedOver: true as const });
  });
}
