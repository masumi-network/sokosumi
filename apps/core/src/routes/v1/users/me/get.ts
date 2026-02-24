import { createRoute } from "@hono/zod-openapi";

import { internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  getCurrentSubscriptionCredits,
  mapSubscription,
} from "@/helpers/subscription";
import { getCredits } from "@/helpers/user";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { type User, userSchema } from "@/schemas/user.schema";

const route = createRoute({
  method: "get",
  path: "/",
  description: "Get current authenticated user",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(userSchema, "Retrieve the current user", {
      data: {
        id: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        name: "John Doe",
        email: "john.doe@example.com",
        emailVerified: true,
        image: "https://example.com/image.png",
        role: "user",
        credits: 100.0,
        subscription: {
          id: "sub_123",
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
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);

    const user: User = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: authContext.userId },
      });
      if (!user) {
        throw internalServerError("Failed to retrieve user");
      }
      const credits = await getCredits(user.id, null, tx);
      const subscription = await tx.subscription.findFirst({
        where: { referenceId: user.id },
        orderBy: { updatedAt: "desc" },
      });
      const subscriptionCredits = await getCurrentSubscriptionCredits({
        subscription,
        userId: user.id,
        organizationId: null,
        tx,
      });

      return userSchema.parse({
        ...user,
        credits,
        subscription: mapSubscription(
          subscription
            ? {
                ...subscription,
                credits: subscriptionCredits,
              }
            : null,
        ),
      });
    });

    return ok(c, user);
  });
}
