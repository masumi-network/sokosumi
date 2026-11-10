import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoOverviewSchema,
  cmoReportIdParamsSchema,
} from "@/schemas/cmo.schema";
import type { CusoTarget } from "@/services/cmo-cuso.service";
import { revertCmoUpdate } from "@/services/cmo-reports.service";

import { requireOverview, rethrow } from "../../../helpers";

export const config = {
  method: "post" as const,
  tags: ["CMO"],
  description:
    "Puts back the strategy a weekly review changed, from its report card: discards the version it wrote while that waits for approval, else approves the version before it again.",
  request: { params: cmoReportIdParamsSchema },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Strategy reverted"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Nothing to revert"),
    409: jsonErrorResponse("The version changed meanwhile"),
  },
};

const route = createRoute({
  ...config,
  path: "/updates/{id}/revert",
  operationId: "revertCmoUpdate",
});

export async function revert(target: CusoTarget, updateId: string) {
  const projectId = await revertCmoUpdate({ ...target, updateId }).catch(
    rethrow,
  );
  return requireOverview({ userId: target.userId, projectId });
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    return ok(c, await revert({ userId }, id));
  });
}
