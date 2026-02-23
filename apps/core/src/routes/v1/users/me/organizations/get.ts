import { createRoute } from "@hono/zod-openapi";

import { attachCreditsToOrganizations } from "@/helpers/credits";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  getCurrentOrganizationSubscriptionCreditsMap,
  getCurrentSubscriptionPeriod,
  mapSubscription,
} from "@/helpers/subscription";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { organizationsSchema } from "@/schemas/organization.schema";

const route = createRoute({
  method: "get",
  path: "/organizations",
  description: "Get all organizations for the current user",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(
      organizationsSchema,
      "Retrieve organizations for current user",
      {
        data: [
          {
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
              credits: {
                total: 100,
                remaining: 57.5,
                used: 42.5,
              },
            },
          },
        ],
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);

    const organizations = await prisma.$transaction(async (tx) => {
      const members = await tx.member.findMany({
        where: { userId: authContext.userId },
        include: { organization: true },
      });

      const organizationsWithCredits = await attachCreditsToOrganizations(
        members.map((member) => ({
          organization: member.organization,
          role: member.role,
        })),
        tx,
      );

      if (organizationsWithCredits.length === 0) {
        return [];
      }

      const subscriptions = await tx.subscription.findMany({
        where: {
          referenceId: {
            in: organizationsWithCredits.map((organization) => organization.id),
          },
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          referenceId: true,
          plan: true,
          status: true,
          periodStart: true,
          periodEnd: true,
          cancelAtPeriodEnd: true,
        },
      });

      const subscriptionsByOrganizationId = new Map<
        string,
        (typeof subscriptions)[number]
      >();
      for (const subscription of subscriptions) {
        if (!subscriptionsByOrganizationId.has(subscription.referenceId)) {
          subscriptionsByOrganizationId.set(
            subscription.referenceId,
            subscription,
          );
        }
      }
      const now = new Date();
      const currentOrganizationPeriods = Array.from(
        subscriptionsByOrganizationId.entries(),
      ).flatMap(([organizationId, subscription]) => {
        const period = getCurrentSubscriptionPeriod(subscription, now);
        return period
          ? [
              {
                organizationId,
                periodStart: period.periodStart,
                periodEnd: period.periodEnd,
              },
            ]
          : [];
      });
      const currentCreditsByOrganizationId =
        await getCurrentOrganizationSubscriptionCreditsMap({
          periods: currentOrganizationPeriods,
          tx,
          now,
        });

      const organizationsWithSubscriptionUsage: Array<
        (typeof organizationsWithCredits)[number] & {
          subscription: ReturnType<typeof mapSubscription>;
        }
      > = [];
      for (const organization of organizationsWithCredits) {
        const subscription =
          subscriptionsByOrganizationId.get(organization.id) ?? null;
        const subscriptionCredits = subscription
          ? (currentCreditsByOrganizationId.get(organization.id) ?? null)
          : null;

        organizationsWithSubscriptionUsage.push({
          ...organization,
          subscription: mapSubscription(
            subscription
              ? {
                  ...subscription,
                  credits: subscriptionCredits,
                }
              : null,
          ),
        });
      }

      return organizationsWithSubscriptionUsage;
    });
    return ok(c, organizationsSchema.parse(organizations));
  });
}
