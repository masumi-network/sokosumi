import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { changeCmoPlan } from "@/services/cmo-plan-change.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/plan",
  operationId: "changeCmoPlanForProject",
  tags: ["CMO"],
  description:
    "Moves this Cuso's CMO subscription to another tier of the same interval. An upgrade applies at once: Polar charges the prorated difference and the extra credits for the rest of the month follow its payment. A downgrade applies at the next renewal and shows as the pending tier until then. The current tier while a downgrade is pending keeps the plan: the pending downgrade is cleared (`kept`). The organization's owners and admins only.",
  request: {
    params: cmoProjectParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            tier: z
              .string()
              .min(1)
              .describe("The tier to move to, as its Polar product names it."),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      z
        .object({ change: z.enum(["upgrade", "downgrade", "kept"]) })
        .openapi("CmoPlanChange"),
      "Plan changed, the downgrade is scheduled, or the pending downgrade is cleared",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Only an organization owner or admin can"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse(
      "Refused with a reason: no active subscription (subscription_not_active, also when past due), a tier of the other interval, the current tier with no downgrade pending, or a scheduled cancel (subscription_change_not_allowed), or the upgrade's payment failed (subscription_payment_failed)",
    ),
    503: jsonErrorResponse("Polar is not configured"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const { tier } = c.req.valid("json");
    const changed = await changeCmoPlan({ userId, projectId, tier }).catch(
      rethrow,
    );
    return ok(c, changed);
  });
}
