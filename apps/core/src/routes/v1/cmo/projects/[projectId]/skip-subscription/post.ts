import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { skipCmoSubscription } from "@/services/cmo-billing.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/skip-subscription",
  operationId: "skipCmoSubscriptionForProject",
  tags: ["CMO"],
  description:
    "A tester on CMO_SUBSCRIPTION_SKIP_ALLOWLIST continues this Cuso without a CMO subscription: his Project gets 10,000 Tester credits, which count like Starter credits for the gate and the hiring steps. Granted again once they are used up; refused while a subscription or such credits pay for him.",
  request: { params: cmoProjectParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      z.object({ skipped: z.literal(true) }),
      "Tester credits granted; reload the overview",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("The caller is not on the skip allowlist"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse(
      "A subscription or credits already pay for this Cuso, or another write raced this one",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    await skipCmoSubscription({ userId, projectId }).catch(rethrow);
    return ok(c, { skipped: true as const });
  });
}
