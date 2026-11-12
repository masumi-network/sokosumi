import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireOverview, rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoOverviewSchema,
  cmoProjectParamsSchema,
  cmoReportIdParamsSchema,
} from "@/schemas/cmo.schema";
import { revertCmoUpdate } from "@/services/cmo-reports.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/updates/{id}/revert",
  operationId: "revertCmoUpdateForProject",
  tags: ["CMO"],
  description:
    "Puts back the strategy a weekly review changed, from its report card: discards the version it wrote while that waits for approval, else approves the version before it again.",
  request: {
    params: cmoProjectParamsSchema.extend(cmoReportIdParamsSchema.shape),
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Strategy reverted"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Nothing to revert"),
    409: jsonErrorResponse("The version changed meanwhile"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, id } = c.req.valid("param");
    await revertCmoUpdate({ userId, projectId, updateId: id }).catch(rethrow);
    return ok(c, await requireOverview({ userId, projectId }));
  });
}
