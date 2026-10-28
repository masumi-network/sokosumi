import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoBrandAnswerRequestSchema,
  cmoOverviewSchema,
} from "@/schemas/cmo.schema";
import { answerCmoBrandQuestion } from "@/services/cmo-brand-brain.service";

import { requireOverview, rethrow } from "../../helpers";

const route = createRoute({
  method: "post",
  path: "/brand-brain/answers",
  operationId: "answerCmoBrandQuestion",
  tags: ["CMO"],
  description:
    "The owner answers one of Cuso's Brand Brain questions: yes, no (with what is true instead) or not sure. A yes or a no with a note lands in its section as a confirmed finding.",
  request: {
    body: {
      content: {
        "application/json": { schema: cmoBrandAnswerRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Answer saved"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet, or no such question"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    await answerCmoBrandQuestion(userId, c.req.valid("json")).catch(rethrow);
    return ok(c, await requireOverview(userId));
  });
}
