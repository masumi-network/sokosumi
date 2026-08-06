import { createRoute, z } from "@hono/zod-openapi";
import {
  getUnusedSeatCount,
  resolveOrganizationBillingPlan,
} from "@sokosumi/database/helpers";
import { memberRepository } from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { organizationSeatSummarySchema } from "@/schemas/organization-seat.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/seat-summary",
  description:
    "Get the seat usage summary for an organization the caller is a member of: assigned and purchased seat counts alongside the resolved paid plan. Seat entitlements only exist for paid plans, so assigned and unused seat counts are 0 for free organizations.",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      organizationSeatSummarySchema,
      "The organization's seat usage summary",
      {
        data: {
          assignedCount: 2,
          memberCount: 5,
          isEnterpriseContract: false,
          paidPlan: "starter",
          purchasedSeats: 3,
          unusedSeats: 1,
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

    const summary = await prisma.$transaction(async (tx) => {
      const { organization } = await resolveMemberOrganizationById({
        id,
        userId: userContext.userId,
        tx,
      });

      const [assignedCount, memberCount, billingPlan] = await Promise.all([
        memberRepository.getAssignedMemberCount(organization.id, tx),
        tx.member.count({
          where: {
            organizationId: organization.id,
          },
        }),
        resolveOrganizationBillingPlan(organization.id, tx),
      ]);

      const paidPlan = billingPlan.plan === "free" ? null : billingPlan.plan;
      const purchasedSeats = billingPlan.purchasedSeats;
      const hasSeatEntitlements = paidPlan != null;

      return {
        assignedCount: hasSeatEntitlements ? assignedCount : 0,
        memberCount,
        isEnterpriseContract: billingPlan.mode === "enterprise_contract",
        paidPlan,
        purchasedSeats,
        unusedSeats: hasSeatEntitlements
          ? getUnusedSeatCount(purchasedSeats, assignedCount)
          : 0,
      };
    });

    return ok(c, organizationSeatSummarySchema.parse(summary));
  });
}
