import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  marketingStrategyParamsSchema,
  marketingStrategySchema,
} from "@/schemas/marketing-strategy.schema";
import { getMarketingStrategy } from "@/services/marketing-strategy.service";

import { mapMarketingStrategy, marketingStrategyScope } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/marketing-strategies/{strategyId}",
    operationId: "getProjectMarketingStrategy",
    tags: ["Projects"],
    description:
      "One version of the Project's Marketing strategy with its plan and yes/no questions.",
    request: { params: marketingStrategyParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        marketingStrategySchema,
        "Marketing strategy version",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { id, strategyId } = c.req.valid("param");
    const { projectId } = await marketingStrategyScope(c, id);
    const version = await getMarketingStrategy(projectId, strategyId);
    return ok(c, marketingStrategySchema.parse(mapMarketingStrategy(version)));
  });
}
