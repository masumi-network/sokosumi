import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireOverview } from "@/routes/v1/cmo/helpers";
import {
  cmoOverviewSchema,
  cmoProjectParamsSchema,
} from "@/schemas/cmo.schema";

/** The overview of the Cuso of the Project the path names. */
const projectRoute = createRoute({
  method: "get",
  path: "/projects/{projectId}",
  operationId: "getCmoOverviewForProject",
  tags: ["CMO"],
  request: { params: cmoProjectParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      cmoOverviewSchema,
      "The Cuso of the Project the path names",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(projectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return ok(c, await requireOverview({ userId, projectId }));
  });
}
