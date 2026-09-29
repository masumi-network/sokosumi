import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { subscribePushDevice } from "@/lib/ably/push-device-consent";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { pushDeviceSubscriptionRequestSchema } from "@/schemas/push-device.schema";

const route = createRoute({
  method: "put",
  path: "/push-devices/{id}/subscription",
  tags: ["Notifications"],
  description: "Subscribe a device only while its recorded consent is current.",
  request: {
    params: z.object({ id: z.string().min(1).max(256) }),
    body: {
      required: true,
      content: {
        "application/json": { schema: pushDeviceSubscriptionRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      z.object({ subscribed: z.boolean() }),
      "Push device updated",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Push device not found"),
    409: jsonErrorResponse("Push device registration changed"),
    422: jsonErrorResponse("Invalid push device request"),
    502: jsonErrorResponse("Unable to manage push device"),
    503: jsonErrorResponse("Push device administration is not configured"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireOwnerUserContext(c.var.authContext);
    c.header("Cache-Control", "private, no-store");
    const subscribed = await subscribePushDevice(
      userId,
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    return ok(c, { subscribed });
  });
}
