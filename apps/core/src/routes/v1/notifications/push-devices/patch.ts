import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { updatePushDeviceBrowser } from "@/lib/ably/push-device-browser";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { pushDeviceBrowserDetailsSchema } from "@/schemas/push-device.schema";

const route = createRoute({
  method: "patch",
  path: "/push-devices/{id}/browser",
  tags: ["Notifications"],
  description:
    "Record coarse browser and OS names for the current user's registered push device.",
  request: {
    params: z.object({ id: z.string().min(1).max(256) }),
    body: {
      required: true,
      content: {
        "application/json": { schema: pushDeviceBrowserDetailsSchema.strict() },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      z.object({ success: z.literal(true) }),
      "Browser details recorded",
    ),
    422: jsonErrorResponse("Invalid browser details"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Push device not found"),
    502: jsonErrorResponse("Unable to update push device"),
    503: jsonErrorResponse("Push device administration is not configured"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireOwnerUserContext(c.var.authContext);
    await updatePushDeviceBrowser(
      userId,
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    c.header("Cache-Control", "private, no-store");
    return ok(c, { success: true as const });
  });
}
