import { createRoute, z } from "@hono/zod-openapi";
import {
  assertPersonalSubscriptionChangeAllowed,
  OrganizationSubscriptionExclusivityError,
} from "@sokosumi/database/helpers";
import { unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const subscriptionChangeAllowedSchema = z
  .object({
    allowed: z.literal(true),
  })
  .openapi("PersonalSubscriptionChangeAllowed");

const route = createRoute({
  method: "get",
  path: "/subscription-change-allowed",
  description:
    "Validate that personal subscription changes are allowed for the user (blocks when a consumable enterprise contract applies).",
  tags: ["Users"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      subscriptionChangeAllowedSchema,
      "Personal subscription changes are allowed",
      {
        data: { allowed: true },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse(
      "Unprocessable Entity - Subscription change blocked",
    ),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    try {
      await prisma.$transaction(async (tx) => {
        await assertPersonalSubscriptionChangeAllowed(resolvedUserId, tx);
      });
    } catch (error) {
      if (error instanceof OrganizationSubscriptionExclusivityError) {
        throw unprocessableEntity(error.message);
      }
      throw error;
    }

    return ok(c, subscriptionChangeAllowedSchema.parse({ allowed: true }));
  });
}
