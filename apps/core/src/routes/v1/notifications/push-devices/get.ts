import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { listPushDevices } from "@/lib/ably/push-devices";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { pushDeviceSchema } from "@/schemas/push-device.schema";

const route = createRoute({
  method: "get",
  path: "/push-devices",
  description:
    "List the current user's push devices subscribed to this environment's notification channel. State describes Ably registration health, not browser permission or delivery preferences.",
  tags: ["Notifications"],
  responses: {
    200: jsonSuccessResponse(
      z.array(pushDeviceSchema),
      "Push devices retrieved",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    502: jsonErrorResponse("Unable to retrieve push devices"),
    503: jsonErrorResponse("Push device listing is not configured"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireOwnerUserContext(c.var.authContext);
    c.header("Cache-Control", "private, no-store");
    return ok(
      c,
      z.array(pushDeviceSchema).parse(await listPushDevices(userId)),
    );
  });
}
