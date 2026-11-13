import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { cmoSubscriptionPlanSchema } from "@/schemas/cmo.schema";
import { getCmoCatalog } from "@/services/cmo-catalog.service";

const route = createRoute({
  method: "get",
  path: "/plans",
  operationId: "listCmoPlans",
  tags: ["CMO"],
  description:
    "The CMO plans a Cuso can be subscribed to, read from Polar's products: monthly before yearly, each by credits.",
  responses: {
    200: jsonSuccessResponse(
      z.array(cmoSubscriptionPlanSchema),
      "The CMO plans",
    ),
    401: jsonErrorResponse("Unauthorized"),
    503: jsonErrorResponse("Polar is not configured"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { plans } = await getCmoCatalog();
    return ok(c, z.array(cmoSubscriptionPlanSchema).parse(plans));
  });
}
