import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoBrandAnswerRequestSchema } from "@/schemas/cmo.schema";
import {
  marketingStrategyParamsSchema,
  marketingStrategySchema,
} from "@/schemas/marketing-strategy.schema";
import { answerMarketingStrategyQuestion } from "@/services/marketing-strategy.service";

import { mapMarketingStrategy, marketingStrategyScope } from "../../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/marketing-strategies/{strategyId}/answers",
    operationId: "answerProjectMarketingStrategyQuestion",
    tags: ["Projects"],
    description:
      "Answer one of this version's yes/no questions: yes, no (with what is true instead) or not sure. The answer stays with this version.",
    request: {
      params: marketingStrategyParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: cmoBrandAnswerRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(marketingStrategySchema, "Answer saved"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { id, strategyId } = c.req.valid("param");
    requireUserAuthContext(c.var.authContext);
    const { projectId } = await marketingStrategyScope(c, id);
    const version = await answerMarketingStrategyQuestion({
      projectId,
      strategyId,
      ...c.req.valid("json"),
    });
    return ok(c, marketingStrategySchema.parse(mapMarketingStrategy(version)));
  });
}
