import { createRoute, z } from "@hono/zod-openapi";

import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapSubscription } from "@/helpers/subscription";
import { getCredits } from "@/helpers/user";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { organizationWithRoleSchema } from "@/schemas/organization.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID or slug",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/organizations/{id}",
  description: "Get organization details by ID or slug",
  tags: ["Users"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      organizationWithRoleSchema,
      "Retrieve organization by ID or slug",
      {
        data: {
          id: "org_123",
          name: "My Organization",
          slug: "my-org",
          createdAt: "2025-01-01T00:00:00.000Z",
          role: "member",
          credits: 100.0,
          subscription: {
            id: "sub_123",
            plan: "starter",
            status: "active",
            periodStart: "2025-01-01T00:00:00.000Z",
            periodEnd: "2025-02-01T00:00:00.000Z",
            cancelAtPeriodEnd: false,
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

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");

    const organization = await prisma.$transaction(async (tx) => {
      // Try to find organization by ID first
      let organization = await tx.organization.findUnique({
        where: { id },
      });

      // If not found by ID, try to find by slug
      if (!organization) {
        organization = await tx.organization.findUnique({
          where: { slug: id },
        });
      }

      // If still not found, throw 404
      if (!organization) {
        throw notFound("Organization not found");
      }

      // Verify user is a member of the organization
      const member = await tx.member.findUnique({
        where: {
          userId_organizationId: {
            userId: authContext.userId,
            organizationId: organization.id,
          },
        },
      });

      if (!member) {
        throw forbidden("You are not a member of this organization");
      }

      // Get organization credits
      const credits = await getCredits(authContext.userId, organization.id, tx);
      const subscription = await tx.subscription.findFirst({
        where: { referenceId: organization.id },
        orderBy: { updatedAt: "desc" },
      });

      return {
        ...organization,
        role: member.role,
        credits,
        subscription: mapSubscription(subscription),
      };
    });

    return ok(c, organizationWithRoleSchema.parse(organization));
  });
}
