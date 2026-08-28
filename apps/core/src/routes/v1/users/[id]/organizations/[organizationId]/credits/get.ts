import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import { buildCreditsPayload } from "@/helpers/subscription";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { creditsResponseSchema } from "@/schemas/user.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
  organizationId: z.string().openapi({
    param: { name: "organizationId", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/organizations/{organizationId}/credits",
    description:
      "Get organization-context credits for a member: first path segment is `me` or a user id; second is the organization id. Session user or coworker with matching authorized `X-Context-User-Id`.",
    tags: ["Users"],
    request: {
      params,
    },
    responses: {
      200: jsonSuccessResponse(
        creditsResponseSchema,
        "Retrieve shared non-subscription organization credits plus the member subscription wallet",
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
            extra: {
              credits: {
                total: 25,
                remaining: 12.5,
                used: 12.5,
              },
              buckets: [
                {
                  total: 25,
                  remaining: 12.5,
                  expiresAt: "2026-08-01T00:00:00.000Z",
                },
              ],
            },
            credits: {
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
              buffer: 12.5,
              total: 70,
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
  }),
);

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

    return ok(c, creditsResponseSchema.parse(payload));
  });
}
