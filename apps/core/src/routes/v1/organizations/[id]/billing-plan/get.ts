import { createRoute, z } from "@hono/zod-openapi";
import { resolveOrganizationBillingPlan } from "@sokosumi/database/helpers";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
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
    "Get the resolved billing plan for an organization the caller is a member of: an active enterprise contract when one exists, otherwise the self-serve subscription plan (free when none is active).",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      organizationBillingPlanSchema,
      "The organization's resolved billing plan",
      {
        data: {
          mode: "self_serve",
          plan: "starter",
          isConsumable: false,
          purchasedSeats: 3,
          cancelAtPeriodEnd: false,
          periodEnd: "2026-03-01T00:00:00.000Z",
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
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const billingPlan = await prisma.$transaction(async (tx) => {
      const { organization } = await resolveMemberOrganizationById({
        id,
        userId: userContext.userId,
        tx,
      });

      return await resolveOrganizationBillingPlan(organization.id, tx);
    });

    return ok(
      c,
      organizationBillingPlanSchema.parse({
        mode: billingPlan.mode,
        plan: billingPlan.plan,
        isConsumable:
          billingPlan.mode === "enterprise_contract"
            ? billingPlan.isConsumable
            : false,
        purchasedSeats: billingPlan.purchasedSeats,
        cancelAtPeriodEnd: billingPlan.cancelAtPeriodEnd,
        periodEnd: billingPlan.periodEnd,
      }),
    );
  });
}
