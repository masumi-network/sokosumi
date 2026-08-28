import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import {
  assertOrganizationSubscriptionChangeAllowed,
  ensurePurchasedSeatsSufficient,
  OrganizationSubscriptionExclusivityError,
  resolvePurchasedSeats,
  unassignSeatsOverPurchasedCapacity,
} from "@sokosumi/database/helpers";
import { subscriptionRepository } from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { stripeClient } from "@/clients/stripe.client";
import { badRequest, internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import {
  organizationSubscriptionSeatsSchema,
  updateOrganizationSubscriptionSeatsSchema,
} from "@/schemas/subscription.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "put",
  path: "/{id}/subscription/seats",
  description:
    "Immediately update the purchased seat count on an organization's active subscription. Only organization owners and admins may do this. For Stripe-backed subscriptions the quantity change is invoiced right away (`proration_behavior: always_invoice`). Local free subscriptions return the stored seat count without changing it. Purchased seats must be at least 1 and may be lower than the current assigned or member count.",
  tags: ["Organizations"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: updateOrganizationSubscriptionSeatsSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      organizationSubscriptionSeatsSchema,
      "The purchased seat count after the update",
      {
        data: {
          seats: 3,
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse(
      "Bad Request - No active subscription, invalid seat count, or enterprise contract exclusivity",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You must be an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found - Organization not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

interface SeatUpdateTarget {
  currentSeats: number;
  organizationId: string;
  stripeSubscriptionId: string | null;
  subscriptionId: string;
}

/**
 * Pushes the new quantity to the first Stripe subscription item, invoicing
 * the proration immediately. Runs outside any Prisma transaction — Stripe
 * calls must never run inside an interactive transaction.
 */
async function increaseStripeSubscriptionSeats(
  stripeSubscriptionId: string,
  seats: number,
): Promise<void> {
  const stripeSubscription =
    await stripeClient.retrieveSubscriptionWithItems(stripeSubscriptionId);

  const firstItem = stripeSubscription.items.data[0];
  if (!firstItem) {
    throw internalServerError(
      "Unable to update organization subscription seats: missing Stripe subscription item",
    );
  }

  await stripeClient.updateSubscriptionItemQuantity(
    stripeSubscriptionId,
    firstItem.id,
    seats,
  );
}

async function persistPurchasedSeatsAndUnassignOverflow(params: {
  subscriptionId: string;
  organizationId: string;
  seats: number;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: params.subscriptionId },
      data: { seats: params.seats },
    });
    await unassignSeatsOverPurchasedCapacity(
      params.organizationId,
      params.seats,
      tx,
    );
  });
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { seats } = c.req.valid("json");

    // Authorization and write-guards run in one read-only transaction; the
    // Stripe call and the local seat write happen afterwards, mirroring the
    // previous sequential flow (Stripe update first, then the local write).
    const target = await prisma.$transaction(
      async (tx): Promise<SeatUpdateTarget> => {
        const { organization } = await resolveMemberOrganizationById({
          id,
          userId: userContext.userId,
          tx,
          allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
        });

        try {
          await assertOrganizationSubscriptionChangeAllowed(
            organization.id,
            tx,
          );
        } catch (error) {
          if (error instanceof OrganizationSubscriptionExclusivityError) {
            throw badRequest(error.message, {
              kind: CORE_API_ERROR_KINDS.SUBSCRIPTION_CHANGE_NOT_ALLOWED,
            });
          }
          throw error;
        }

        const subscription =
          await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
            organization.id,
            tx,
          );
        if (!subscription) {
          throw badRequest(
            "An active organization subscription is required before updating seats.",
            { kind: CORE_API_ERROR_KINDS.SUBSCRIPTION_NOT_ACTIVE },
          );
        }

        try {
          ensurePurchasedSeatsSufficient(seats);
        } catch (error) {
          throw badRequest(
            error instanceof Error
              ? error.message
              : "Purchased seats must be an integer of at least 1",
          );
        }

        return {
          currentSeats: resolvePurchasedSeats(subscription.seats),
          organizationId: organization.id,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          subscriptionId: subscription.id,
        };
      },
    );

    if (!target.stripeSubscriptionId) {
      return ok(
        c,
        organizationSubscriptionSeatsSchema.parse({
          seats: target.currentSeats,
        }),
      );
    }

    if (target.currentSeats === seats) {
      return ok(
        c,
        organizationSubscriptionSeatsSchema.parse({
          seats: target.currentSeats,
        }),
      );
    }

    await increaseStripeSubscriptionSeats(target.stripeSubscriptionId, seats);

    try {
      await persistPurchasedSeatsAndUnassignOverflow({
        subscriptionId: target.subscriptionId,
        organizationId: target.organizationId,
        seats,
      });
    } catch (error) {
      try {
        await persistPurchasedSeatsAndUnassignOverflow({
          subscriptionId: target.subscriptionId,
          organizationId: target.organizationId,
          seats,
        });
      } catch {
        await prisma.$transaction(async (tx) => {
          await unassignSeatsOverPurchasedCapacity(
            target.organizationId,
            seats,
            tx,
          );
        });
        throw error;
      }
    }

    return ok(c, organizationSubscriptionSeatsSchema.parse({ seats }));
  });
}
