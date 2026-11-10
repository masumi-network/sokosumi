import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoProjectParamsSchema,
  cmoStrategyRequestSchema,
  cmoTurnStartedSchema,
} from "@/schemas/cmo.schema";
import { requestCmoStrategy } from "@/services/cmo-strategy.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/strategy",
  operationId: "requestCmoStrategyForProject",
  tags: ["CMO"],
  request: {
    params: cmoProjectParamsSchema,
    body: {
      content: { "application/json": { schema: cmoStrategyRequestSchema } },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      cmoTurnStartedSchema,
      "Cuso started planning the month",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse(
      "The Brand Brain is not ready yet, or Cuso is still writing the plan or finishing a change",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const { note, patch, restart } = c.req.valid("json");
    const started = await requestCmoStrategy({
      userId,
      projectId,
      note,
      patch,
      restart,
    }).catch(rethrow);
    return created(c, cmoTurnStartedSchema.parse(started));
  });
}
