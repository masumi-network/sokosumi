import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireOverview, rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoMeasurementSchema,
  cmoOverviewSchema,
  cmoProjectParamsSchema,
} from "@/schemas/cmo.schema";
import { finalizeCmoMeasurement } from "@/services/cmo-measurement.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/measurement/{provider}/finalize",
  operationId: "finalizeCmoMeasurementForProject",
  tags: ["CMO"],
  description:
    "Finishes connecting a measurement source once the owner is back from signing in.",
  request: {
    params: cmoProjectParamsSchema.extend({
      provider: cmoMeasurementSchema.shape.provider,
    }),
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Connected"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not connected"),
    503: jsonErrorResponse("Connecting this is not set up"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, provider } = c.req.valid("param");
    await finalizeCmoMeasurement({ userId, projectId, provider }).catch(
      rethrow,
    );
    return ok(c, await requireOverview({ userId, projectId }));
  });
}
