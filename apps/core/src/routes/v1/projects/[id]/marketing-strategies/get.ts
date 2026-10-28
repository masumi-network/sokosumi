import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  marketingStrategyParamsSchema,
  marketingStrategyVersionSchema,
} from "@/schemas/marketing-strategy.schema";
import { listMarketingStrategies } from "@/services/marketing-strategy.service";

import { marketingStrategyScope } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/marketing-strategies",
    operationId: "listProjectMarketingStrategies",
    tags: ["Projects"],
    description:
      "The versions of the Project's Marketing strategy, newest first, without their plans. At most one is approved.",
    request: {
      params: marketingStrategyParamsSchema.pick({ id: true }),
    },
    responses: {
      200: jsonSuccessResponse(
        z.array(marketingStrategyVersionSchema),
        "Marketing strategy versions",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { projectId } = await marketingStrategyScope(c, id);
    const versions = await listMarketingStrategies(projectId);
    return ok(
      c,
      versions.map(({ turnId: _turnId, ...version }) =>
        marketingStrategyVersionSchema.parse(version),
      ),
    );
  });
}
