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
import { projectCompetitorUpdateSchema } from "@/schemas/project-competitors.schema";
import { requireCuso } from "@/services/cmo-cuso.service";
import { updateTrackedCompetitor } from "@/services/competitors.service";

import { competitorsResponse } from "../helpers.js";

const route = createRoute({
  method: "patch",
  path: "/projects/{projectId}/competitors/{competitorId}",
  operationId: "updateCmoCompetitorForProject",
  tags: ["CMO"],
  description:
    "A member changes a tracked competitor's name, website, pricing page or accounts. A field left out stays; null clears it. Later Brand Brain research leaves a changed competitor alone.",
  request: {
    params: cmoCompetitorParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: projectCompetitorUpdateSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoCompetitorsSchema, "Competitor changed"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet, or no such competitor"),
    409: jsonErrorResponse("Another tracked competitor has this name"),
    422: jsonErrorResponse("Not a web address or an account"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, competitorId } = c.req.valid("param");
    const target = { userId, projectId };
    await requireCuso(target).catch(rethrow);
    await updateTrackedCompetitor(projectId, competitorId, c.req.valid("json"));
    return ok(c, await competitorsResponse(target));
  });
}
