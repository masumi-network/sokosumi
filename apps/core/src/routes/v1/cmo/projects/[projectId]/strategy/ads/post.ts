import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoAdBudgetRequestSchema,
  cmoProjectParamsSchema,
  cmoTurnStartedSchema,
} from "@/schemas/cmo.schema";
import { setCmoAdBudget } from "@/services/cmo-strategy.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/strategy/ads",
  operationId: "setCmoAdBudgetForProject",
  tags: ["CMO"],
  description:
    "The owner's monthly ad budget. Stored as theirs (Cuso keeps it), then Cuso re-plans the ads around it. Zero leaves paid ads out.",
  request: {
    params: cmoProjectParamsSchema,
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
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const started = await setCmoAdBudget({
      userId,
      projectId,
      ...c.req.valid("json"),
    }).catch(rethrow);
    return created(c, cmoTurnStartedSchema.parse(started));
  });
}
