import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationByIdOrSlug } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import {
  getCreditSummary,
  getCurrentSubscriptionCredits,
  mapSubscription,
} from "@/helpers/subscription";
import { getCredits } from "@/helpers/user";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { creditsResponseSchema } from "@/schemas/user.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID or slug",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/organizations/{id}/credits",
  description: "Get organization credit balance by ID or slug",
  tags: ["Users"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      creditsResponseSchema,
      "Retrieve organization credits",
      {
        data: {
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
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const credits = await prisma.$transaction(async (tx) => {
      const { organization } = await resolveMemberOrganizationByIdOrSlug({
        idOrSlug: id,
        userId: authContext.userId,
        tx,
      });
      const totalCredits = await getCredits(
        authContext.userId,
        organization.id,
        tx,
      );
      const latestSubscription = await tx.subscription.findFirst({
        where: { referenceId: organization.id },
        orderBy: { updatedAt: "desc" },
      });
      const subscriptionCredits = await getCurrentSubscriptionCredits({
        subscription: latestSubscription,
        userId: authContext.userId,
        organizationId: organization.id,
        tx,
      });
      const subscription = mapSubscription(
        latestSubscription
          ? {
              ...latestSubscription,
              credits: subscriptionCredits,
            }
          : null,
      );
      const { buffer, total } = getCreditSummary({
        totalCredits,
        subscriptionCredits,
      });

      return {
        subscription,
        buffer,
        total,
      };
    });

    return ok(c, creditsResponseSchema.parse({ credits }));
  });
}
