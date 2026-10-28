import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoOverviewSchema } from "@/schemas/cmo.schema";
import { approveCmoBrandBrain } from "@/services/cmo-brand-brain.service";

import { requireOverview, rethrow } from "../../helpers";

const route = createRoute({
  method: "post",
  path: "/brand-brain/approve",
  operationId: "approveCmoBrandBrain",
  tags: ["CMO"],
  description:
    "The owner approved the Brand Brain. Cuso's yes/no questions come next, then the strategy.",
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Brand Brain approved"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse("Cuso is still building the Brand Brain"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    await approveCmoBrandBrain(userId).catch(rethrow);
    return ok(c, await requireOverview(userId));
  });
}
