import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoCompetitorFeedItemParamsSchema,
  cmoCompetitorsSchema,
} from "@/schemas/cmo-competitors.schema";
import { addCompetitorMoveToStrategy } from "@/services/cmo-competitor-feed.service";

import { competitorsResponse } from "../../../helpers.js";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/competitors/feed/{itemId}/strategy",
  operationId: "addCmoCompetitorMoveToStrategyForProject",
  tags: ["CMO"],
  description:
    "A member sends one move from Cuso's This week to the strategy: Cuso patches the strategy with it, as with a typed change, and the move is marked as added.",
  request: { params: cmoCompetitorFeedItemParamsSchema },
  responses: {
    200: jsonSuccessResponse(cmoCompetitorsSchema, "Sent to the strategy"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet, or the move is gone"),
    409: jsonErrorResponse(
      "Already in the strategy, Cuso is finishing a change, or he is paused",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, itemId } = c.req.valid("param");
    const target = { userId, projectId };
    await addCompetitorMoveToStrategy(target, itemId).catch(rethrow);
    return ok(c, await competitorsResponse(target));
  });
}
