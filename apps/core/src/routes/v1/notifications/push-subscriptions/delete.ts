import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { pushSubscriptionDeleteBodySchema } from "@/schemas/notification.schema";

const route = createRoute({
  method: "delete",
  path: "/push-subscriptions",
  operationId: "deletePushSubscription",
  description:
    "Delete a Web Push subscription for the authenticated user by endpoint (idempotent)",
  tags: ["Notifications"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: pushSubscriptionDeleteBodySchema,
        },
      },
    },
  },
  responses: {
    204: {
      description: "Push subscription deleted (or already absent)",
    },
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userAuth = requireUserAuthContext(c.var.authContext);
    const body = c.req.valid("json");

    await prisma.pushSubscription.deleteMany({
      where: {
        userId: userAuth.userId,
        endpoint: body.endpoint,
      },
    });

    return c.body(null, 204);
  });
}
