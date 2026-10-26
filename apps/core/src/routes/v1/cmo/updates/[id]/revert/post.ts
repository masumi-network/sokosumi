import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoOverviewSchema,
  cmoUpdateIdParamsSchema,
} from "@/schemas/cmo.schema";
import { revertCmoUpdate } from "@/services/cmo.service";

import { requireOverview, rethrow } from "../../../helpers";

const route = createRoute({
  method: "post",
  path: "/updates/{id}/revert",
  operationId: "revertCmoUpdate",
  tags: ["CMO"],
  description: "Puts back the strategy a weekly review changed.",
  request: { params: cmoUpdateIdParamsSchema },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Strategy reverted"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Nothing to revert"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    await revertCmoUpdate({ userId, updateId: id }).catch(rethrow);
    return ok(c, await requireOverview(userId));
  });
}
