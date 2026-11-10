import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import type { CusoTarget } from "@/services/cmo-cuso.service";
import { startCmoOver } from "@/services/cmo-hiring.service";

import { rethrow } from "../helpers";

const config = {
  method: "post" as const,
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
};

const route = createRoute({
  ...config,
  path: "/start-over",
  operationId: "startCmoOver",
});

/** The same, for the Cuso of the Project the path names. */
const projectRoute = createRoute({
  ...config,
  path: "/projects/{projectId}/start-over",
  operationId: "startCmoOverForProject",
  request: { params: cmoProjectParamsSchema },
});

async function startOver(target: CusoTarget) {
  await startCmoOver(target).catch(rethrow);
  return { startedOver: true as const };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    return ok(c, await startOver({ userId }));
  });

  app.openapi(projectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return ok(c, await startOver({ userId, projectId }));
  });
}
