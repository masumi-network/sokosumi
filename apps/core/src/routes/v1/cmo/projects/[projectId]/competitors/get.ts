import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { cmoCompetitorsSchema } from "@/schemas/cmo-competitors.schema";

import { competitorsResponse } from "./helpers.js";

const route = createRoute({
  method: "get",
  path: "/projects/{projectId}/competitors",
  operationId: "getCmoCompetitorsForProject",
  tags: ["CMO"],
  description:
    "The competitors the Cuso's Project tracks, what the weekly checks of the last 30 days found, the Instagram scoreboard and how each source of the check stands. A pure read.",
  request: { params: cmoProjectParamsSchema },
  responses: {
    200: jsonSuccessResponse(cmoCompetitorsSchema, "Tracked competitors"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return ok(c, await competitorsResponse({ userId, projectId }));
  });
}
