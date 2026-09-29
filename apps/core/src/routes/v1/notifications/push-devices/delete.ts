import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { revokePushDevice } from "@/lib/ably/push-device-consent";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";

const route = createRoute({
  method: "delete",
  path: "/push-devices/{id}",
  tags: ["Notifications"],
  description:
    "Revoke push for one of the current user’s devices and its replacements.",
  request: { params: z.object({ id: z.string().min(1).max(256) }) },
  responses: {
    200: jsonSuccessResponse(
      z.object({ success: z.literal(true) }),
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
    await revokePushDevice(userId, c.req.valid("param").id);
    return ok(c, { success: true as const });
  });
}
