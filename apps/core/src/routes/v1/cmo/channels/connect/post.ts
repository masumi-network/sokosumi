import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { projectSocialProviderSchema } from "@/schemas/project-social-connection.schema";
import { connectCmoChannel } from "@/services/cmo.service";

import { rethrow } from "../../helpers";

const route = createRoute({
  method: "post",
  path: "/channels/connect",
  operationId: "connectCmoChannel",
  tags: ["CMO"],
  description:
    "Starts connecting a social account to Cuso's Project; the provider sends the owner back to callbackUrl on CMO.xyz.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            provider: projectSocialProviderSchema,
            callbackUrl: z.string().url(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      z.object({ redirectUrl: z.string() }).openapi("CmoChannelConnect"),
      "Provider sign-in started",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse("Unknown return address"),
    503: jsonErrorResponse("Connecting this network is not set up"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const body = c.req.valid("json");
    const started = await connectCmoChannel({ userId, ...body }).catch(rethrow);
    return ok(c, started);
  });
}
