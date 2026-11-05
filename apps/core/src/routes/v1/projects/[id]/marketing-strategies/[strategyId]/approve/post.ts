import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  marketingStrategyParamsSchema,
  marketingStrategySchema,
} from "@/schemas/marketing-strategy.schema";
import { startCmoProductionForProject } from "@/services/cmo-cuso.service";
import { approveMarketingStrategy } from "@/services/marketing-strategy.service";

import { requireWorkspaceProject } from "../../../access";
import { mapMarketingStrategy } from "../../context";

const route = createRoute({
  method: "post",
  path: "/{id}/marketing-strategies/{strategyId}/approve",
  operationId: "approveProjectMarketingStrategy",
  tags: ["Projects"],
  description:
    "Approve this version: from now on only it is carried out, and any other version's approval is withdrawn. Approving an older version reverts to it. The Workspace's organization owners and admins only (a personal Workspace: its owner). A Project's Cuso with an active CMO plan makes the month right away.",
  request: { params: marketingStrategyParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      marketingStrategySchema,
      "Marketing strategy version approved",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("A new version is being written"),
  },
});

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    // A person approves; bots and coworkers never do.
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id, strategyId } = c.req.valid("param");
    const access = await requireWorkspaceProject(c, id, userId);
    const version = await approveMarketingStrategy({ ...access, strategyId });
    await startCmoProductionForProject(access.projectId);
    return ok(c, marketingStrategySchema.parse(mapMarketingStrategy(version)));
  });
}
