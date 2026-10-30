import { createRoute, z } from "@hono/zod-openapi";
import {
  ensurePurchasedSeatsSufficient,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import Stripe from "stripe";

import { stripeClient } from "@/clients/stripe.client";
import { badRequest, paymentRequired } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import {
  isCancellationScheduled,
  releaseSeatReduction,
  resolveSubscriptionForSeatChange,
  retrieveStripeSeatSubscription,
  scheduleSeatReduction,
} from "@/helpers/organization-subscription-seats";
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
    "Change the purchased seat count on an organization's active subscription. Only organization owners and admins may do this. For Stripe-backed subscriptions, adding seats is invoiced right away (`proration_behavior: always_invoice`) and cancels any pending reduction. Removing seats schedules the lower count for the next renewal without a refund: `seats` stays the same until then and `scheduledReduction` holds the new count. Sending the current count cancels a pending reduction. Local free subscriptions return the stored seat count without changing it. Purchased seats must be at least 1 and may be lower than the current assigned or member count.",
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
          scheduledReduction: null,
          seats: 3,
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse(
      "Bad Request - No active subscription, invalid seat count, enterprise contract exclusivity, or a reduction while the plan is ending or another change is scheduled",
    ),
    401: jsonErrorResponse("Unauthorized"),
    402: jsonErrorResponse(
      "Payment Required - Stripe could not collect the payment; the seat count is unchanged",
    ),
    403: jsonErrorResponse(
      "Forbidden - You must be an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found - Organization not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

/**
 * Pushes the higher quantity to the first Stripe subscription item, invoicing
 * the proration immediately. Runs outside any Prisma transaction — Stripe
 * calls must never run inside an interactive transaction.
 *
 * `error_if_incomplete` makes Stripe answer 402 and leave the subscription
 * unchanged when it cannot collect the payment, so retrying is safe.
 */
async function addStripeSubscriptionSeats(
  stripeSubscriptionId: string,
  seatItemId: string,
  seats: number,
): Promise<void> {
  try {
    await stripeClient.updateSubscriptionItemQuantity(
      stripeSubscriptionId,
      seatItemId,
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

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { seats } = c.req.valid("json");

    const { subscription } = await resolveSubscriptionForSeatChange({
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

    if (
      !subscription.stripeSubscriptionId ||
      (currentSeats === seats && !subscription.stripeScheduleId)
    ) {
      return ok(
        c,
        organizationSubscriptionSeatsSchema.parse({
          scheduledReduction: null,
          seats: currentSeats,
        }),
      );
    }

    const { seatItem, stripeSubscription } =
      await retrieveStripeSeatSubscription(subscription.stripeSubscriptionId);

    if (seats < currentSeats) {
      if (isCancellationScheduled(stripeSubscription)) {
        throw badRequest(
          "This plan is ending, and its seats end with it. Seats can be removed after resuming the plan.",
          { kind: CORE_API_ERROR_KINDS.SUBSCRIPTION_CHANGE_NOT_ALLOWED },
        );
      }

      const { reduction, scheduleId } = await scheduleSeatReduction(
        stripeSubscription,
        seats,
      );
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { stripeScheduleId: scheduleId },
      });

      return ok(
        c,
        organizationSubscriptionSeatsSchema.parse({
          scheduledReduction: reduction,
          seats: currentSeats,
        }),
      );
    }

    if (seats > currentSeats) {
      await addStripeSubscriptionSeats(
        subscription.stripeSubscriptionId,
        seatItem.id,
        seats,
      );
      // Not retried: the webhook for this quantity change writes the same seat
      // count, and repeating this request is safe once Stripe has it.
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { seats },
      });
    }

    // After the charge, so a declined card leaves the pending reduction alone.
    if (await releaseSeatReduction(stripeSubscription)) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { stripeScheduleId: null },
      });
    }

    return ok(
      c,
      organizationSubscriptionSeatsSchema.parse({
        scheduledReduction: null,
        seats,
      }),
    );
  });
}
