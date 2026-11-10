import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoOnboardingRequestSchema,
  cmoOverviewSchema,
} from "@/schemas/cmo.schema";
import { startCmoOnboarding } from "@/services/cmo-hiring.service";

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
    403: jsonErrorResponse(
      "Forbidden - Not a member of the organization (organization_membership_required), no Seat in it (organization_seat_required), or the organization limit is reached (organization_limit_reached)",
    ),
    409: jsonErrorResponse(
      "Conflict - The organization is out of credits (insufficient_balance)",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const body = c.req.valid("json");
    const cuso = await startCmoOnboarding({ userId, ...body }).catch(rethrow);
    // The hired Cuso, by his Project, which CMO names from here on.
    return created(
      c,
      await requireOverview({ userId, projectId: cuso.projectId }),
    );
  });
}
