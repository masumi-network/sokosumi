import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { startCmoTopUpCheckout } from "@/services/cmo-top-up.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/top-up",
  operationId: "startCmoTopUpForProject",
  tags: ["CMO"],
  description:
    "Starts Polar's checkout for a Project top-up of this Cuso and returns its URL; the checkout offers every top-up pack and the member comes back to returnUrl on CMO.xyz. Any member of the Cuso's organization may buy. Refused with 409 (subscription_not_active) when the Cuso has no active CMO subscription.",
  request: {
    params: cmoProjectParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: z.object({ returnUrl: z.string().url() }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      z.object({ url: z.string() }).openapi("CmoTopUpCheckout"),
      "Checkout started",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse(
      "No active CMO subscription (subscription_not_active), or an unknown return address",
    ),
    503: jsonErrorResponse("Polar is not configured"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const { returnUrl } = c.req.valid("json");
    const checkout = await startCmoTopUpCheckout({
      userId,
      projectId,
      returnUrl,
    }).catch(rethrow);
    return ok(c, checkout);
  });
}
