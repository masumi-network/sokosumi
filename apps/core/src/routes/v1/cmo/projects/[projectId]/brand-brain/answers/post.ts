import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { mapBrandBrainForApi } from "@/routes/v1/projects/[id]/brand-brain/context";
import { brandBrainSchema } from "@/schemas/brand-brain.schema";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { questionAnswerRequestSchema } from "@/schemas/question-answer.schema";
import { getBrandBrain } from "@/services/brand-brain.service";
import { answerCmoBrandQuestion } from "@/services/cmo-strategy.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/brand-brain/answers",
  operationId: "answerCmoBrandBrainQuestionForProject",
  tags: ["CMO"],
  description:
    "A member answers one of the Brand Brain's yes/no questions on the Cuso's Project, as `POST /v1/projects/{id}/brand-brain/answers` does: yes, no (with what is true instead) or not sure. A no is a fix on its section: Cuso rewrites it, and patches the plan once one exists, as soon as his current turn ends.",
  request: {
    params: cmoProjectParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: questionAnswerRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(brandBrainSchema, "Answer saved"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet, or no such question"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    await answerCmoBrandQuestion({
      userId,
      projectId,
      ...c.req.valid("json"),
    }).catch(rethrow);
    return ok(c, mapBrandBrainForApi(await getBrandBrain(projectId)));
  });
}
