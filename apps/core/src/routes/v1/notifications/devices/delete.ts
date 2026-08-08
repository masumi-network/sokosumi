import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { pushDeviceTokenSchema } from "@/schemas/push-device.schema";

const responseSchema = z
  .object({
    deleted: z.boolean().openapi({ example: true }),
  })
  .openapi("UnregisterPushDeviceResponse");

const route = createRoute({
  method: "delete",
  path: "/devices",
  description:
    "Stop sending push notifications to this app install. Called on sign-out, so the next person to use the device does not receive the last one's notifications.",
  tags: ["Notifications"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z
            .object({ token: pushDeviceTokenSchema })
            .openapi("UnregisterPushDeviceRequest"),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(responseSchema, "Device unregistered", {
      data: { deleted: true },
      meta: {
        timestamp: "2026-08-08T09:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { token } = c.req.valid("json");

    // Scoped to this user's own row. Unregistering must not be a way to silence
    // somebody else's device by guessing their token.
    const result = await prisma.pushDevice.deleteMany({
      where: { userId: userContext.userId, token },
    });

    // `deleted: false` rather than a 404: signing out twice, or signing out on
    // a device that never registered, is not an error the app can act on.
    return ok(c, responseSchema.parse({ deleted: result.count > 0 }));
  });
}
