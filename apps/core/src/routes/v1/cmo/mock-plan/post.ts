import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoMockPlanRequestSchema,
  cmoOverviewSchema,
} from "@/schemas/cmo.schema";
import { chooseCmoMockPlan } from "@/services/cmo-billing.service";

import { requireOverview, rethrow } from "../helpers";

const route = createRoute({
  method: "post",
  path: "/mock-plan",
  operationId: "chooseCmoMockPlan",
  tags: ["CMO"],
  description:
    "Activates a CMO tier without checkout. Local and preview runs only (CMO_MOCK_BILLING); production answers 409.",
  request: {
    body: {
      content: { "application/json": { schema: cmoMockPlanRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Mock plan active"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse("Mock billing is off on this server"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { plan } = c.req.valid("json");
    await chooseCmoMockPlan(userId, plan).catch(rethrow);
    return ok(c, await requireOverview(userId));
  });
}
