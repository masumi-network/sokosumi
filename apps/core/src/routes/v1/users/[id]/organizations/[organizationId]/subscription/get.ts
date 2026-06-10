import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import { buildCreditsPayload } from "@/helpers/subscription";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { userSubscriptionResponseSchema } from "@/schemas/user.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
  organizationId: z.string().openapi({
    param: { name: "organizationId", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/organizations/{organizationId}/subscription",
  description:
    "Get organization-context subscription for a member: first path segment is `me` or a user id; second is the organization id.",
  tags: ["Users"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      userSubscriptionResponseSchema,
      "Retrieve the member subscription wallet for an organization",
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
    403: jsonErrorResponse(
      "Forbidden - You are not a member of this organization",
    ),
    404: jsonErrorResponse("Not Found - Organization not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { organizationId } = c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const payload = await prisma.$transaction(async (tx) => {
      const { organization } = await resolveMemberOrganizationById({
        id: organizationId,
        userId: resolvedUserId,
        tx,
      });

      return await buildCreditsPayload({
        userId: resolvedUserId,
        organizationId: organization.id,
        referenceId: organization.id,
        tx,
      });
    });

    return ok(
      c,
      userSubscriptionResponseSchema.parse({
        subscription: payload.subscription,
      }),
    );
  });
}
