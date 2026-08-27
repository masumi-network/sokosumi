import { createRoute } from "@hono/zod-openapi";
import { resolveOrganizationBillingPlan } from "@sokosumi/database/helpers";
import {
  memberRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";

import { getAdminOrganizationBySlug } from "@/helpers/admin-organization-overview.js";
import { internalServerError, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { adminOrganizationMemberIdParamSchema } from "@/schemas/admin.schema";
import { organizationSeatAssignmentSchema } from "@/schemas/organization-seat.schema";
import {
  mapSeatRepositoryError,
  syncLocalFreeOrganizationCreditsIfNeeded,
} from "@/services/organization-seat.service";

const route = createRoute({
  method: "put",
  path: "/{slug}/members/{memberId}/seat",
  operationId: "assignAdminOrganizationMemberSeat",
  description: "Assign a seat to an organization member (admin only).",
  tags: ["Admin"],
  request: {
    params: adminOrganizationMemberIdParamSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      organizationSeatAssignmentSchema,
      "The assigned seat",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { slug, memberId } = c.req.valid("param");

    const organization = await getAdminOrganizationBySlug(slug, prisma);
    if (!organization) {
      throw notFound("Organization not found");
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const billingPlan = await resolveOrganizationBillingPlan(
          organization.id,
          tx,
        );
        const purchasedSeats = billingPlan.purchasedSeats;
        const subscription =
          billingPlan.mode === "self_serve"
            ? await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
                organization.id,
                tx,
              )
            : null;

        const member = await memberRepository.assignSeat(
          memberId,
          organization.id,
          purchasedSeats,
          tx,
        );

        if (!member.seatAssignedAt) {
          throw internalServerError("Failed to assign seat");
        }

        if (
          billingPlan.mode === "self_serve" &&
          subscription?.periodStart &&
          subscription?.periodEnd
        ) {
          await syncLocalFreeOrganizationCreditsIfNeeded(
            organization.id,
            {
              createdAt: subscription.createdAt,
              periodEnd: subscription.periodEnd,
              periodStart: subscription.periodStart,
              seats: subscription.seats,
              status: subscription.status,
              stripeSubscriptionId: subscription.stripeSubscriptionId,
            },
            tx,
          );
        }

        return {
          memberId: member.id,
          seatAssignedAt: member.seatAssignedAt,
        };
      });

      return ok(c, organizationSeatAssignmentSchema.parse(result));
    } catch (error) {
      mapSeatRepositoryError(error);
    }
  });
}
