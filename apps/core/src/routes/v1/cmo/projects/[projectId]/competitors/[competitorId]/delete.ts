import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoCompetitorParamsSchema,
  cmoCompetitorsSchema,
} from "@/schemas/cmo-competitors.schema";
import { removeTrackedCompetitor } from "@/services/cmo-competitors.service";

import { competitorsResponse } from "../helpers.js";

const route = createRoute({
  method: "delete",
  path: "/projects/{projectId}/competitors/{competitorId}",
  operationId: "removeCmoCompetitorForProject",
  tags: ["CMO"],
  description:
    "A member stops tracking a competitor. It is no longer checked or shown, and Brand Brain research does not add it back.",
  request: { params: cmoCompetitorParamsSchema },
  responses: {
    200: jsonSuccessResponse(cmoCompetitorsSchema, "Competitor removed"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet, or no such competitor"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, competitorId } = c.req.valid("param");
    const target = { userId, projectId };
    await removeTrackedCompetitor(target, competitorId).catch(rethrow);
    return ok(c, await competitorsResponse(target));
  });
}
