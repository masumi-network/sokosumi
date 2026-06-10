import { createRoute, z } from "@hono/zod-openapi";
import { resolveOrganizationBillingPlan } from "@sokosumi/database/helpers";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { organizationBillingPlanSchema } from "@/schemas/organization-billing-plan.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/billing-plan",
  description:
    "Resolve the organization's billing plan for subscription and seat management.",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      organizationBillingPlanSchema,
      "Organization billing plan",
      {
        data: {
          mode: "self_serve",
          plan: "starter",
          purchasedSeats: 5,
          subscriptionId: "sub_123",
          cancelAtPeriodEnd: false,
          periodEnd: "2026-04-01T00:00:00.000Z",
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
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const now = new Date();

    const billingPlan = await prisma.$transaction(async (tx) => {
      await resolveMemberOrganizationById({
        id,
        userId: userContext.userId,
        tx,
      });

      return resolveOrganizationBillingPlan(id, tx, now);
    });

    return ok(c, organizationBillingPlanSchema.parse(billingPlan));
  });
}
