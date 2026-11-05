import { createRoute, z } from "@hono/zod-openapi";
import { resolvePurchasedSeats } from "@sokosumi/database/helpers";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { stripeClient } from "@/clients/stripe.client";
import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import {
  previewRenewalAtSeats,
  resolveSubscriptionForSeatChange,
  retrieveStripeSeatSubscription,
} from "@/helpers/organization-subscription-seats";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import {
  organizationSubscriptionSeatsPreviewQuerySchema,
  organizationSubscriptionSeatsPreviewSchema,
} from "@/schemas/subscription.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/subscription/seats/preview",
  description:
    "Preview what changing the purchased seat count would cost. Adding seats uses Stripe's own proration and tax; Stripe prorates by the second, so the charge can differ slightly from this preview. Removing seats charges and refunds nothing and takes effect at `effectiveAt`. Nothing changes until `PUT /{id}/subscription/seats` is called. Only organization owners and admins may do this.",
  tags: ["Organizations"],
  request: {
    params,
    query: organizationSubscriptionSeatsPreviewQuerySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      organizationSubscriptionSeatsPreviewSchema,
      "What the seat change would cost",
      {
        data: {
          amountDue: 1234,
          currency: "eur",
          effectiveAt: null,
          newMonthlyAmount: 14875,
          seats: 5,
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse(
      "Bad Request - No active Stripe subscription, or enterprise contract exclusivity",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You must be an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found - Organization not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { seats } = c.req.valid("query");

    const { subscription } = await resolveSubscriptionForSeatChange({
      organizationId: id,
      userId: userContext.userId,
    });
    if (!subscription.stripeSubscriptionId) {
      throw badRequest(
        "A paid organization subscription is required before previewing seats.",
        { kind: CORE_API_ERROR_KINDS.SUBSCRIPTION_NOT_ACTIVE },
      );
    }

    const { seatItem, stripeSubscription } =
      await retrieveStripeSeatSubscription(subscription.stripeSubscriptionId);
    const currentSeats = resolvePurchasedSeats(subscription.seats);
    const [invoice, renewalInvoice] = await Promise.all([
      seats > currentSeats
        ? stripeClient.previewSubscriptionItemQuantity(
            subscription.stripeSubscriptionId,
            seatItem.id,
            seats,
          )
        : null,
      previewRenewalAtSeats({
        seatItemId: seatItem.id,
        seats,
        stripeSubscription,
      }),
    ]);

    return ok(
      c,
      organizationSubscriptionSeatsPreviewSchema.parse({
        amountDue: invoice?.amount_due ?? 0,
        currency: renewalInvoice.currency,
        effectiveAt:
          seats < currentSeats
            ? new Date(seatItem.current_period_end * 1000)
            : null,
        newMonthlyAmount: renewalInvoice.total,
        seats,
      }),
    );
  });
}
