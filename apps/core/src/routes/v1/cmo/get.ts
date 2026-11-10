import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoOverviewSchema,
  cmoProjectParamsSchema,
} from "@/schemas/cmo.schema";

import { requireOverview } from "./helpers";

const config = {
  method: "get" as const,
  tags: ["CMO"],
  responses: {
    200: jsonSuccessResponse(
      cmoOverviewSchema,
      "The Cuso the caller works with",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
  },
};

const route = createRoute({
  ...config,
  path: "/",
  operationId: "getCmoOverview",
});

/** The same, for the Cuso of the Project the path names. */
const projectRoute = createRoute({
  ...config,
  path: "/projects/{projectId}",
  operationId: "getCmoOverviewForProject",
  request: { params: cmoProjectParamsSchema },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    return ok(c, await requireOverview({ userId }));
  });

  app.openapi(projectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return ok(c, await requireOverview({ userId, projectId }));
  });
}
