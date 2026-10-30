import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import {
  ensurePurchasedSeatsSufficient,
  resolvePurchasedSeats,
  unassignSeatsOverPurchasedCapacity,
} from "@sokosumi/database/helpers";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import Stripe from "stripe";

import { stripeClient } from "@/clients/stripe.client";
import { badRequest, paymentRequired } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import {
  resolveSubscriptionForSeatChange,
  retrieveStripeSeatItem,
} from "@/helpers/organization-subscription-seats";
import { ok } from "@/helpers/response";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import {
  organizationSubscriptionSeatsSchema,
  updateOrganizationSubscriptionSeatsSchema,
} from "@/schemas/subscription.schema";
import { SEAT_CHANGE_CONFLICT_MESSAGE } from "@/services/organization-seat.service";

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
    402: jsonErrorResponse(
      "Payment Required - Stripe could not collect the payment; the seat count is unchanged",
    ),
    403: jsonErrorResponse(
      "Forbidden - You must be an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found - Organization not found"),
    409: jsonErrorResponse("Conflict"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

/**
 * Pushes the new quantity to the first Stripe subscription item, invoicing
 * the proration immediately. Runs outside any Prisma transaction — Stripe
 * calls must never run inside an interactive transaction.
 *
 * `error_if_incomplete` makes Stripe answer 402 and leave the subscription
 * unchanged when it cannot collect the payment, so retrying is safe.
 */
async function updateStripeSubscriptionSeats(
  stripeSubscriptionId: string,
  seats: number,
): Promise<void> {
  const seatItem = await retrieveStripeSeatItem(stripeSubscriptionId);

  try {
    await stripeClient.updateSubscriptionItemQuantity(
      stripeSubscriptionId,
      seatItem.id,
      seats,
    );
  } catch (error) {
    if (
      error instanceof Stripe.errors.StripeError &&
      error.statusCode === 402
    ) {
      throw paymentRequired(
        "The payment could not be collected. Update your payment method and try again.",
        { kind: CORE_API_ERROR_KINDS.SUBSCRIPTION_PAYMENT_FAILED },
      );
    }
    throw error;
  }
}

/**
 * Serializable so the purchased-seat write and the overflow unassign commit
 * as one unit (SOK-1007): a concurrent seat assignment cannot read the old
 * capacity, pass its check and land after the reduction.
 */
async function persistPurchasedSeatsAndUnassignOverflow(params: {
  subscriptionId: string;
  organizationId: string;
  seats: number;
}): Promise<void> {
  await serializableTransaction(async (tx) => {
    await tx.subscription.update({
      where: { id: params.subscriptionId },
      data: { seats: params.seats },
    });
    await unassignSeatsOverPurchasedCapacity(
      params.organizationId,
      params.seats,
      tx,
    );
  }, SEAT_CHANGE_CONFLICT_MESSAGE);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { seats } = c.req.valid("json");

    const { organization, subscription } =
      await resolveSubscriptionForSeatChange({
        organizationId: id,
        userId: userContext.userId,
      });

    try {
      ensurePurchasedSeatsSufficient(seats);
    } catch (error) {
      throw badRequest(
        error instanceof Error
          ? error.message
          : "Purchased seats must be an integer of at least 1",
      );
    }

    const currentSeats = resolvePurchasedSeats(subscription.seats);

    if (!subscription.stripeSubscriptionId) {
      return ok(
        c,
        organizationSubscriptionSeatsSchema.parse({
          seats: currentSeats,
        }),
      );
    }

    if (currentSeats === seats) {
      return ok(
        c,
        organizationSubscriptionSeatsSchema.parse({
          seats: currentSeats,
        }),
      );
    }

    await updateStripeSubscriptionSeats(
      subscription.stripeSubscriptionId,
      seats,
    );

    try {
      await persistPurchasedSeatsAndUnassignOverflow({
        subscriptionId: subscription.id,
        organizationId: organization.id,
        seats,
      });
    } catch (error) {
      try {
        await persistPurchasedSeatsAndUnassignOverflow({
          subscriptionId: subscription.id,
          organizationId: organization.id,
          seats,
        });
      } catch {
        // Last-resort cleanup after both persist attempts failed. Stripe
        // already bills the new seat count, so the overflow has to go even
        // though the seat write did not land. Its own failure is reported and
        // then dropped: the caller needs the error that explains the failed
        // persist, not whatever the cleanup hit on top of it.
        try {
          await serializableTransaction(async (tx) => {
            await unassignSeatsOverPurchasedCapacity(
              organization.id,
              seats,
              tx,
            );
          }, SEAT_CHANGE_CONFLICT_MESSAGE);
        } catch (cleanupError) {
          Sentry.captureException(cleanupError, {
            tags: { context: "organization_seat_reduction_cleanup" },
            extra: { organizationId: organization.id, seats },
          });
        }
        throw error;
      }
    }

    return ok(c, organizationSubscriptionSeatsSchema.parse({ seats }));
  });
}
