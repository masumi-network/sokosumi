import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { openCmoCustomerPortal } from "@/services/cmo-plan-change.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/portal",
  operationId: "openCmoCustomerPortalForProject",
  tags: ["CMO"],
  description:
    "Answers a Polar customer portal link for this Cuso's organization, Polar's customer: cancel, change the payment method and read invoices of every Cuso it pays for. The portal links back to returnUrl on CMO.xyz. The organization's owners and admins only.",
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
      z.object({ url: z.string() }).openapi("CmoCustomerPortal"),
      "Portal link",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Only an organization owner or admin can"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse(
      "The organization never paid at Polar (subscription_not_active), or an unknown return address",
    ),
    503: jsonErrorResponse("Polar is not configured"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const portal = await openCmoCustomerPortal({
      userId,
      projectId,
      ...c.req.valid("json"),
    }).catch(rethrow);
    return ok(c, portal);
  });
}
