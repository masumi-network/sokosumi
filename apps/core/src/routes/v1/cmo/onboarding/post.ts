import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoOnboardingRequestSchema,
  cmoOverviewSchema,
} from "@/schemas/cmo.schema";
import { startCmoOnboarding } from "@/services/cmo.service";

import { requireOverview, rethrow } from "../helpers";

const route = createRoute({
  method: "post",
  path: "/onboarding",
  operationId: "startCmoOnboarding",
  tags: ["CMO"],
  request: {
    body: {
      content: { "application/json": { schema: cmoOnboardingRequestSchema } },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      cmoOverviewSchema,
      "Cuso hired; he is learning the business",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden - The organization limit is reached"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const body = c.req.valid("json");
    await startCmoOnboarding({ userId, ...body }).catch(rethrow);
    return created(c, await requireOverview(userId));
  });
}
