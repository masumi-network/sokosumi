import { createRoute, z } from "@hono/zod-openapi";
import { subscriptionRepository } from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { activeSubscriptionResponseSchema } from "@/schemas/subscription.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/subscription",
  description:
    "Get the active subscription for an organization the caller is a member of. `subscription` is null when the organization has no active subscription (e.g. free plan or enterprise contract billing).",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      activeSubscriptionResponseSchema,
      "The organization's active subscription (null when none)",
      {
        data: {
          subscription: {
            plan: "starter",
            status: "active",
            cancelAtPeriodEnd: false,
            periodStart: "2025-01-01T00:00:00.000Z",
            periodEnd: "2025-02-01T00:00:00.000Z",
            seats: 3,
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
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const { organization } = await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
    });

    const subscription =
      await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
        organization.id,
        prisma,
      );

    return ok(c, activeSubscriptionResponseSchema.parse({ subscription }));
  });
}
