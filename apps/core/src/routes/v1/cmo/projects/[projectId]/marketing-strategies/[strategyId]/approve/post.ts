import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { mapMarketingStrategy } from "@/routes/v1/projects/[id]/marketing-strategies/context";
import { cmoStrategyParamsSchema } from "@/schemas/cmo.schema";
import { marketingStrategySchema } from "@/schemas/marketing-strategy.schema";
import {
  requireCuso,
  startCmoProductionForProject,
} from "@/services/cmo-cuso.service";
import { approveMarketingStrategy } from "@/services/marketing-strategy.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/marketing-strategies/{strategyId}/approve",
  operationId: "approveCmoMarketingStrategyForProject",
  tags: ["CMO"],
  description:
    "Approves this version of the Cuso's plan, as `POST /v1/projects/{id}/marketing-strategies/{strategyId}/approve` does: only it is carried out from now on. The organization's owners and admins only (ADR 0061). With an active CMO plan Cuso makes the month right away.",
  request: { params: cmoStrategyParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      marketingStrategySchema,
      "Marketing strategy version approved",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet, or no such version"),
    409: jsonErrorResponse("A new version is being written"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, strategyId } = c.req.valid("param");
    const cuso = await requireCuso({ userId, projectId }).catch(rethrow);
    const version = await approveMarketingStrategy({
      userId,
      projectId: cuso.projectId,
      workspaceId: cuso.workspaceId,
      strategyId,
    });
    await startCmoProductionForProject(cuso.projectId);
    return ok(c, marketingStrategySchema.parse(mapMarketingStrategy(version)));
  });
}
