import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { beginPushActivation } from "@/lib/ably/push-device-consent";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import {
  pushDeviceActivationRequestSchema,
  pushDeviceActivationSchema,
} from "@/schemas/push-device.schema";

const route = createRoute({
  method: "post",
  path: "/push-devices/activations",
  tags: ["Notifications"],
  description: "Begin or resume this browser’s push activation.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: pushDeviceActivationRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(pushDeviceActivationSchema, "Push device updated"),
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
    const result = await beginPushActivation(userId, c.req.valid("json"));
    return ok(c, result);
  });
}
