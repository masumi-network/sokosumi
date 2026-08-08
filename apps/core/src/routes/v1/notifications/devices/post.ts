import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import {
  pushDeviceSchema,
  registerPushDeviceRequestSchema,
} from "@/schemas/push-device.schema";

const route = createRoute({
  method: "post",
  path: "/devices",
  description:
    "Register this app install to receive push notifications. Idempotent: re-registering the same token for the same user refreshes it rather than adding a second device, which is what lets the app register on every launch.",
  tags: ["Notifications"],
  request: {
    body: {
      content: {
        "application/json": { schema: registerPushDeviceRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(pushDeviceSchema, "Device registered", {
      data: {
        id: "0199c0f0-0000-7000-8000-000000000000",
        platform: "IOS",
        lastSeenAt: "2026-08-08T09:00:00.000Z",
        createdAt: "2026-08-08T09:00:00.000Z",
      },
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
    // Owner context: a coworker acting on someone's behalf must not be able to
    // point that person's notifications at a device.
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { token, platform } = c.req.valid("json");

    const device = await prisma.pushDevice.upsert({
      where: { userId_token: { userId: userContext.userId, token } },
      // A token can move between users on a shared device — sign out, sign in
      // as someone else — so the same token may exist under another user. That
      // row is left alone here and reaped when a send to it is rejected; the
      // provider is the only thing that knows which install is still live.
      create: { userId: userContext.userId, token, platform },
      update: { platform, lastSeenAt: new Date() },
    });

    return ok(c, pushDeviceSchema.parse(device));
  });
}
