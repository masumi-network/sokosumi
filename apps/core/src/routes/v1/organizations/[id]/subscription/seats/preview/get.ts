import { createRoute, z } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { stripeClient } from "@/clients/stripe.client";
import { badRequest, internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import {
  resolveSubscriptionForSeatChange,
  retrieveStripeSeatItem,
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
    "Preview what changing the purchased seat count would cost, using Stripe's own proration and tax. Nothing changes until `PUT /{id}/subscription/seats` is called. Stripe prorates by the second, so the charge can differ slightly from this preview. Only organization owners and admins may do this.",
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
          creditAmount: 0,
          currency: "eur",
          newMonthlyAmount: 12500,
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

    const seatItem = await retrieveStripeSeatItem(
      subscription.stripeSubscriptionId,
    );
    const unitAmount = seatItem.price.unit_amount;
    if (unitAmount === null) {
      throw internalServerError(
        "Unable to preview organization subscription seats: Stripe price has no unit amount",
      );
    }

    const invoice = await stripeClient.previewSubscriptionItemQuantity(
      subscription.stripeSubscriptionId,
      seatItem.id,
      seats,
    );

    return ok(
      c,
      organizationSubscriptionSeatsPreviewSchema.parse({
        amountDue: invoice.amount_due,
        creditAmount: Math.max(-invoice.total, 0),
        currency: invoice.currency,
        newMonthlyAmount: unitAmount * seats,
        seats,
      }),
    );
  });
}
