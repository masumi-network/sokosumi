import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { mapMarketingStrategy } from "@/routes/v1/projects/[id]/marketing-strategies/context";
import { cmoStrategyParamsSchema } from "@/schemas/cmo.schema";
import { marketingStrategySchema } from "@/schemas/marketing-strategy.schema";
import { questionAnswerRequestSchema } from "@/schemas/question-answer.schema";
import { requireCuso } from "@/services/cmo-cuso.service";
import { answerMarketingStrategyQuestion } from "@/services/marketing-strategy.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/marketing-strategies/{strategyId}/answers",
  operationId: "answerCmoMarketingStrategyQuestionForProject",
  tags: ["CMO"],
  description:
    "A member answers one of this plan version's yes/no questions, as `POST /v1/projects/{id}/marketing-strategies/{strategyId}/answers` does. The answer stays with this version.",
  request: {
    params: cmoStrategyParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: questionAnswerRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(marketingStrategySchema, "Answer saved"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet, or no such version"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, strategyId } = c.req.valid("param");
    const cuso = await requireCuso({ userId, projectId }).catch(rethrow);
    const version = await answerMarketingStrategyQuestion({
      projectId: cuso.projectId,
      strategyId,
      ...c.req.valid("json"),
    });
    return ok(c, marketingStrategySchema.parse(mapMarketingStrategy(version)));
  });
}
