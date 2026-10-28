import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoOverviewSchema } from "@/schemas/cmo.schema";
import { approveCmoStrategy } from "@/services/cmo-strategy.service";

import { requireOverview, rethrow } from "../../helpers";

const route = createRoute({
  method: "post",
  path: "/strategy/approve",
  operationId: "approveCmoStrategy",
  tags: ["CMO"],
  description:
    "The owner's one approval: from now on Cuso executes the strategy on its own (with an active CMO subscription).",
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Strategy approved"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse("There is no strategy to approve yet"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    await approveCmoStrategy(userId).catch(rethrow);
    return ok(c, await requireOverview(userId));
  });
}
