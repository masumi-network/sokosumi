import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoProjectParamsSchema,
  cmoTurnStartedSchema,
} from "@/schemas/cmo.schema";
import { applyCmoPlanAnswers } from "@/services/cmo-strategy.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/strategy/answers/apply",
  operationId: "applyCmoPlanAnswersForProject",
  tags: ["CMO"],
  description:
    "Cuso changes the plan where the owner's answers say an assumption was wrong.",
  request: { params: cmoProjectParamsSchema },
  responses: {
    201: jsonSuccessResponse(cmoTurnStartedSchema, "Cuso is changing the plan"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse("The answers confirm the plan"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const started = await applyCmoPlanAnswers({ userId, projectId }).catch(
      rethrow,
    );
    return created(c, cmoTurnStartedSchema.parse(started));
  });
}
