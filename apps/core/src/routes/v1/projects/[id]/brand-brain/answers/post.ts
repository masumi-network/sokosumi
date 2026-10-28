import { createRoute } from "@hono/zod-openapi";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  brandBrainProjectParamsSchema,
  brandBrainSchema,
} from "@/schemas/brand-brain.schema";
import { questionAnswerRequestSchema } from "@/schemas/question-answer.schema";
import {
  answerBrandBrainQuestion,
  getBrandBrain,
} from "@/services/brand-brain.service";

import { requireWorkspaceProject } from "../../access";
import { mapBrandBrainForApi } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/brand-brain/answers",
    operationId: "answerProjectBrandBrainQuestion",
    tags: ["Projects"],
    description:
      "A member answers one of the Brand Brain's yes/no questions: yes, no (with what is true instead) or not sure. A yes or a no with a note lands in its section as a confirmed finding.",
    request: {
      params: brandBrainProjectParamsSchema,
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
      404: jsonErrorResponse("Not Found, or no such question"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const { userId } = await requireAuthorizedUserContext(c.var.authContext);
    const { projectId } = await requireWorkspaceProject(
      c,
      c.req.valid("param").id,
      userId,
    );
    await answerBrandBrainQuestion(projectId, c.req.valid("json"));
    return ok(c, mapBrandBrainForApi(await getBrandBrain(projectId)));
  });
}
