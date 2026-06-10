import { createRoute, z } from "@hono/zod-openapi";

import { resolveOnboardingStatus } from "@/helpers/onboarding-status";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { userOnboardingStatusResponseSchema } from "@/schemas/user.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/onboarding/status",
  description:
    "Get onboarding visibility status with auto-complete-when-in-org logic.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      userOnboardingStatusResponseSchema,
      "Retrieve onboarding show/completed status",
      {
        data: {
          show: true,
          completed: false,
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const status = await prisma.$transaction(async (tx) => {
      return resolveOnboardingStatus(resolvedUserId, tx);
    });

    return ok(c, userOnboardingStatusResponseSchema.parse(status));
  });
}
