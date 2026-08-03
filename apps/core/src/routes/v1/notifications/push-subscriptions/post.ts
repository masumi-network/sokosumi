import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  pushSubscriptionSchema,
  pushSubscriptionUpsertBodySchema,
} from "@/schemas/notification.schema";

const route = createRoute({
  method: "post",
  path: "/push-subscriptions",
  operationId: "upsertPushSubscription",
  description:
    "Upsert a Web Push subscription for the authenticated user (keyed by endpoint)",
  tags: ["Notifications"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: pushSubscriptionUpsertBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      pushSubscriptionSchema,
      "Upserted Web Push subscription",
      {
        data: {
          id: "01960001-0001-7001-8001-000000000001",
          endpoint: "https://fcm.googleapis.com/fcm/send/abc",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
        meta: {
          timestamp: "2026-08-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userAuth = requireUserAuthContext(c.var.authContext);
    const body = c.req.valid("json");

    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        userId: userAuth.userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
      update: {
        userId: userAuth.userId,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });

    return ok(
      c,
      pushSubscriptionSchema.parse({
        id: subscription.id,
        endpoint: subscription.endpoint,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      }),
    );
  });
}
