import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoProjectParamsSchema,
  cmoSubscriptionPlanSchema,
} from "@/schemas/cmo.schema";
import { startCmoPlanCheckout } from "@/services/cmo-checkout.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/checkout",
  operationId: "startCmoPlanCheckoutForProject",
  tags: ["CMO"],
  description:
    "Starts Polar's hosted checkout for this Cuso's CMO plan: the interval's plans, without trial or discount codes. Any member of his organization may pay; the person comes back to returnUrl on CMO.xyz, and the subscription shows in the overview once Polar confirms the payment.",
  request: {
    params: cmoProjectParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            interval: cmoSubscriptionPlanSchema.shape.interval,
            tier: cmoSubscriptionPlanSchema.shape.tier
              .optional()
              .describe("The plan Polar's checkout opens on."),
            returnUrl: z.string().url(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      z.object({ url: z.string() }).openapi("CmoCheckout"),
      "Checkout started",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse(
      "This Cuso already has a CMO subscription, or an unknown return address",
    ),
    503: jsonErrorResponse("Polar is not configured"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const started = await startCmoPlanCheckout({
      userId,
      projectId,
      ...c.req.valid("json"),
    }).catch(rethrow);
    return ok(c, started);
  });
}
