import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoTurnStartedSchema } from "@/schemas/cmo.schema";
import { retryCmoOnboarding } from "@/services/cmo-hiring.service";

import { rethrow } from "../../helpers";

const route = createRoute({
  method: "post",
  path: "/onboarding/retry",
  operationId: "retryCmoOnboarding",
  tags: ["CMO"],
  description:
    "Starts Cuso's first look at the business again after it failed or got stuck.",
  responses: {
    201: jsonSuccessResponse(cmoTurnStartedSchema, "Cuso is learning again"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse("Cuso is still learning or already done"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const started = await retryCmoOnboarding(userId).catch(rethrow);
    return created(c, cmoTurnStartedSchema.parse(started));
  });
}
