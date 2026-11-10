import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoProjectParamsSchema,
  cmoTurnStartedSchema,
} from "@/schemas/cmo.schema";
import type { CusoTarget } from "@/services/cmo-cuso.service";
import { applyCmoPlanAnswers } from "@/services/cmo-strategy.service";

import { rethrow } from "../../../helpers";

const config = {
  method: "post" as const,
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
};

const route = createRoute({
  ...config,
  path: "/strategy/answers/apply",
  operationId: "applyCmoPlanAnswers",
});

/** The same, for the Cuso of the Project the path names. */
const projectRoute = createRoute({
  ...config,
  path: "/projects/{projectId}/strategy/answers/apply",
  operationId: "applyCmoPlanAnswersForProject",
  request: { params: cmoProjectParamsSchema },
});

async function apply(target: CusoTarget) {
  const started = await applyCmoPlanAnswers(target).catch(rethrow);
  return cmoTurnStartedSchema.parse(started);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    return created(c, await apply({ userId }));
  });

  app.openapi(projectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return created(c, await apply({ userId, projectId }));
  });
}
