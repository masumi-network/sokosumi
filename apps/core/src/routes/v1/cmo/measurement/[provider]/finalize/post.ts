import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoMeasurementSchema, cmoOverviewSchema } from "@/schemas/cmo.schema";
import type { CusoTarget } from "@/services/cmo-cuso.service";
import { finalizeCmoMeasurement } from "@/services/cmo-measurement.service";

import { requireOverview, rethrow } from "../../../helpers";

export const config = {
  method: "post" as const,
  tags: ["CMO"],
  description:
    "Finishes connecting a measurement source once the owner is back from signing in.",
  request: {
    params: z.object({ provider: cmoMeasurementSchema.shape.provider }),
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Connected"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not connected"),
    503: jsonErrorResponse("Connecting this is not set up"),
  },
};

const route = createRoute({
  ...config,
  path: "/measurement/{provider}/finalize",
  operationId: "finalizeCmoMeasurement",
});

export async function finalize(target: CusoTarget, provider: string) {
  await finalizeCmoMeasurement({ ...target, provider }).catch(rethrow);
  return requireOverview(target);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { provider } = c.req.valid("param");
    return ok(c, await finalize({ userId }, provider));
  });
}
