import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoOverviewSchema,
  cmoStrategyApproveRequestSchema,
} from "@/schemas/cmo.schema";
import { approveCmoStrategy } from "@/services/cmo-strategy.service";

import { requireOverview, rethrow } from "../../helpers";

const route = createRoute({
  method: "post",
  path: "/strategy/approve",
  operationId: "approveCmoStrategy",
  tags: ["CMO"],
  description:
    "An owner or admin approves a Marketing strategy version, the newest unless one is named: from now on Cuso carries out that one (with an active CMO subscription). Approving an older version reverts to it.",
  request: {
    body: {
      required: false,
      content: {
        "application/json": { schema: cmoStrategyApproveRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Strategy approved"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet, or no such version"),
    409: jsonErrorResponse(
      "There is no strategy to approve yet, or Cuso is writing a new version",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    await approveCmoStrategy(userId, c.req.valid("json")?.versionId).catch(
      rethrow,
    );
    return ok(c, await requireOverview(userId));
  });
}
