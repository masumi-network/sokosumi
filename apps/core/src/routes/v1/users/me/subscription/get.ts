import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  getCurrentSubscriptionCredits,
  mapSubscription,
} from "@/helpers/subscription";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { subscriptionResponseSchema } from "@/schemas/user.schema";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/subscription",
    description: "Get current user's or organization's latest subscription",
    tags: ["Users"],
    responses: {
      200: jsonSuccessResponse(
        subscriptionResponseSchema,
        "Retrieve the current user's or organization's subscription",
        {
          data: {
            subscription: {
              plan: "starter",
              status: "active",
              periodStart: "2025-01-01T00:00:00.000Z",
              periodEnd: "2025-02-01T00:00:00.000Z",
              cancelAtPeriodEnd: false,
              credits: {
                total: 100,
                remaining: 57.5,
                used: 42.5,
              },
            },
          },
          meta: {
            timestamp: "2025-01-01T00:00:00.000Z",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
          },
        },
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);

    const subscription = await prisma.$transaction(async (tx) => {
      const latestSubscription = await tx.subscription.findFirst({
        where: {
          referenceId: authContext.organizationId ?? authContext.userId,
        },
        orderBy: { updatedAt: "desc" },
      });

      const subscriptionCredits = await getCurrentSubscriptionCredits({
        subscription: latestSubscription,
        userId: authContext.userId,
        organizationId: authContext.organizationId,
        tx,
      });

      return mapSubscription(
        latestSubscription
          ? {
              ...latestSubscription,
              credits: subscriptionCredits,
            }
          : null,
      );
    });

    return ok(c, subscriptionResponseSchema.parse({ subscription }));
  });
}
