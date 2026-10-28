import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoTurnStartedSchema } from "@/schemas/cmo.schema";
import { applyCmoPlanAnswers } from "@/services/cmo.service";

import { rethrow } from "../../../helpers";

const route = createRoute({
  method: "post",
  path: "/strategy/answers/apply",
  operationId: "applyCmoPlanAnswers",
  tags: ["CMO"],
  description:
    "Cuso changes the plan where the owner's answers say an assumption was wrong.",
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
    const started = await applyCmoPlanAnswers(userId).catch(rethrow);
    return created(c, cmoTurnStartedSchema.parse(started));
  });
}
