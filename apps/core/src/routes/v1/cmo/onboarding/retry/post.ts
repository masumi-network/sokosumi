import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoTurnStartedSchema } from "@/schemas/cmo.schema";
import type { CusoTarget } from "@/services/cmo-cuso.service";
import { retryCmoOnboarding } from "@/services/cmo-hiring.service";

import { rethrow } from "../../helpers";

export const config = {
  method: "post" as const,
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
};

const route = createRoute({
  ...config,
  path: "/onboarding/retry",
  operationId: "retryCmoOnboarding",
});

export async function retry(target: CusoTarget) {
  const started = await retryCmoOnboarding(target).catch(rethrow);
  return cmoTurnStartedSchema.parse(started);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    return created(c, await retry({ userId }));
  });
}
