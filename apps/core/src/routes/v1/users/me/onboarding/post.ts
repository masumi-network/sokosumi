import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { userOnboardingResponseSchema } from "@/schemas/user.schema";

const route = createRoute({
  method: "post",
  path: "/onboarding",
  description: "Mark onboarding as completed for current user",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(
      userOnboardingResponseSchema,
      "Complete onboarding for the current user",
      {
        data: {
          completed: true,
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
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
    const authContext = requireUserAuthContext(c.var.authContext);

    const onboarding = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: authContext.userId },
        data: {
          onboardingCompleted: true,
        },
        select: {
          onboardingCompleted: true,
        },
      });

      return {
        completed: updatedUser.onboardingCompleted,
      };
    });

    return ok(c, userOnboardingResponseSchema.parse(onboarding));
  });
}
