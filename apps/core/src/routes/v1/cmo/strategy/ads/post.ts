import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoAdBudgetRequestSchema,
  cmoProjectParamsSchema,
  cmoTurnStartedSchema,
} from "@/schemas/cmo.schema";
import type { CusoTarget } from "@/services/cmo-cuso.service";
import { setCmoAdBudget } from "@/services/cmo-strategy.service";

import { rethrow } from "../../helpers";

const config = {
  method: "post" as const,
  tags: ["CMO"],
  description:
    "The owner's monthly ad budget. Stored as theirs (Cuso keeps it), then Cuso re-plans the ads around it. Zero leaves paid ads out.",
  request: {
    body: {
      content: { "application/json": { schema: cmoAdBudgetRequestSchema } },
    },
  },
  responses: {
    201: jsonSuccessResponse(cmoTurnStartedSchema, "Cuso is re-planning"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse("There is no strategy yet"),
  },
};

const route = createRoute({
  ...config,
  path: "/strategy/ads",
  operationId: "setCmoAdBudget",
});

/** The same, for the Cuso of the Project the path names. */
const projectRoute = createRoute({
  ...config,
  path: "/projects/{projectId}/strategy/ads",
  operationId: "setCmoAdBudgetForProject",
  request: { ...config.request, params: cmoProjectParamsSchema },
});

async function setBudget(
  target: CusoTarget,
  budget: { monthly: number; currency: string },
) {
  const started = await setCmoAdBudget({ ...target, ...budget }).catch(rethrow);
  return cmoTurnStartedSchema.parse(started);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    return created(c, await setBudget({ userId }, c.req.valid("json")));
  });

  app.openapi(projectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return created(
      c,
      await setBudget({ userId, projectId }, c.req.valid("json")),
    );
  });
}
