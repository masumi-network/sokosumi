import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  marketingStrategyParamsSchema,
  marketingStrategySchema,
} from "@/schemas/marketing-strategy.schema";
import { questionAnswerRequestSchema } from "@/schemas/question-answer.schema";
import { answerMarketingStrategyQuestion } from "@/services/marketing-strategy.service";

import { requireWorkspaceProject } from "../../../access";
import { mapMarketingStrategy } from "../../context";

const route = createRoute({
  method: "post",
  path: "/{id}/marketing-strategies/{strategyId}/answers",
  operationId: "answerProjectMarketingStrategyQuestion",
  tags: ["Projects"],
  description:
    "A member answers one of this version's yes/no questions: yes, no (with what is true instead) or not sure. The answer stays with this version.",
  request: {
    params: marketingStrategyParamsSchema,
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
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    // A person answers; bots and coworkers ask.
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id, strategyId } = c.req.valid("param");
    const { projectId } = await requireWorkspaceProject(c, id, userId);
    const version = await answerMarketingStrategyQuestion({
      projectId,
      strategyId,
      ...c.req.valid("json"),
    });
    return ok(c, marketingStrategySchema.parse(mapMarketingStrategy(version)));
  });
}
