import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { resolveOrganizationBillingPlan } from "@sokosumi/database/helpers";
import {
  memberRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";

import { internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { organizationSeatAssignmentSchema } from "@/schemas/organization-seat.schema";
import {
  grantUnusedSeatSubscriptionCreditsIfEligible,
  mapSeatRepositoryError,
  syncLocalFreeOrganizationCreditsIfNeeded,
} from "@/services/organization-seat.service";
import { getSubscriptionSeatCredits } from "@/services/subscription-seat-credits.service";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
  memberId: z.string().openapi({
    param: { name: "memberId", in: "path" },
    description: "Member ID",
    example: "member_123",
  }),
});

const route = createRoute({
  method: "put",
  path: "/{id}/members/{memberId}/seat",
  description:
    "Assign a seat to an organization member. Only organization owners and admins may do this. The assignment, capacity check, and any resulting credit grants (with per-seat amounts resolved from the Stripe subscription catalog) happen in a single transaction.",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      organizationSeatAssignmentSchema,
      "The assigned seat",
      {
        data: {
          memberId: "member_123",
          seatAssignedAt: "2025-01-01T00:00:00.000Z",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request - No unused seats available"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You must be an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found - Organization or member not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id, memberId } = c.req.valid("param");

    // Pre-warm the per-seat credits cache before opening the transaction: on
    // a cold cache (every fresh deploy) the lookup makes three Stripe calls,
    // which would otherwise run inside the interactive transaction and could
    // exceed its timeout. The grant flow's in-transaction lookup then awaits
    // the same cached promise. Failures are swallowed here on purpose — the
    // in-transaction lookup keeps its abort-with-500 semantics.
    void getSubscriptionSeatCredits().catch(() => {});

    try {
      const result = await prisma.$transaction(async (tx) => {
        const { organization } = await resolveMemberOrganizationById({
          id,
          userId: userContext.userId,
          tx,
          allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
        });

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

        const suppressSelfServeSeatCredits =
          billingPlan.mode === "enterprise_contract" &&
          billingPlan.isConsumable;

        if (!suppressSelfServeSeatCredits) {
          await grantUnusedSeatSubscriptionCreditsIfEligible(
            organization.id,
            member.userId,
            tx,
          );
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
