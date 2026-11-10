import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoMeasurementSchema } from "@/schemas/cmo.schema";
import type { CusoTarget } from "@/services/cmo-cuso.service";
import { connectCmoMeasurement } from "@/services/cmo-measurement.service";

import { rethrow } from "../../../helpers";

export const config = {
  method: "post" as const,
  tags: ["CMO"],
  description:
    "Starts connecting Google Analytics, Search Console or Shopify to Cuso so he can measure the funnel; the owner comes back to returnUrl on CMO.xyz.",
  request: {
    params: z.object({ provider: cmoMeasurementSchema.shape.provider }),
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
      z.object({ redirectUrl: z.string() }).openapi("CmoMeasurementConnect"),
      "Sign-in started",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse("Unknown return address"),
    503: jsonErrorResponse("Connecting this is not set up"),
  },
};

const route = createRoute({
  ...config,
  path: "/measurement/{provider}/connect",
  operationId: "connectCmoMeasurement",
});

export function connect(
  target: CusoTarget,
  provider: string,
  returnUrl: string,
) {
  return connectCmoMeasurement({ ...target, provider, returnUrl }).catch(
    rethrow,
  );
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { provider } = c.req.valid("param");
    const { returnUrl } = c.req.valid("json");
    return ok(c, await connect({ userId }, provider, returnUrl));
  });
}
