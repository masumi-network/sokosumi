import { createRoute } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapUserToResponse } from "@/helpers/user";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { type User, userSchema } from "@/schemas/user.schema";

const route = createRoute({
  method: "post",
  path: "/me/complete-onboarding",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(
      userSchema,
      "Complete onboarding for the current user",
      {
        data: {
          id: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          name: "John Doe",
          email: "john.doe@example.com",
          image: "https://example.com/image.png",
          credits: 100.0,
          marketingOptIn: true,
          notificationsOptIn: true,
          onboardingCompleted: true,
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;

    const user: User = await prisma.$transaction(async (tx) => {
      // Mark onboarding as completed
      const updatedUser = await tx.user.update({
        where: { id: authContext.userId },
        data: {
          onboardingCompleted: true,
        },
      });

      return await mapUserToResponse(updatedUser, tx);
    });

    return ok(c, user);
  });
}
