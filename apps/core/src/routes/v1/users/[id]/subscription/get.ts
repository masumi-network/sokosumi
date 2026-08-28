import { createRoute, z } from "@hono/zod-openapi";
import { subscriptionRepository } from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { activeSubscriptionResponseSchema } from "@/schemas/subscription.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/subscription",
    description:
      "Get the active personal subscription for a user (path `me` for the session user, or a user id the caller may access). `subscription` is null when the user has no active personal subscription (free plan).",
    tags: ["Users"],
    request: {
      params,
    },
    responses: {
      200: jsonSuccessResponse(
        activeSubscriptionResponseSchema,
        "The user's active personal subscription (null when none)",
        {
          data: {
            subscription: {
              plan: "starter",
              status: "active",
              cancelAtPeriodEnd: false,
              periodStart: "2025-01-01T00:00:00.000Z",
              periodEnd: "2025-02-01T00:00:00.000Z",
              seats: 1,
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
      404: jsonErrorResponse("Not Found - User not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    // Validate the path param shape; the resolved user id comes from the route
    // context (`me` resolution + access checks), not the raw param.
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const subscription =
      await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
        resolvedUserId,
        prisma,
      );

    return ok(c, activeSubscriptionResponseSchema.parse({ subscription }));
  });
}
