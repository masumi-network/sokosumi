import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { provisionedStripeCustomerSchema } from "@/schemas/stripe.schema";
import { provisionUserStripeCustomer } from "@/services/stripe-customer-provision.service";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/stripe-customer",
    description:
      "Ensure a Stripe customer exists for a user (path `me` for the session user, or a user id the caller may access). Returns the existing customer id when already provisioned, otherwise creates the Stripe customer, persists the id immediately, and returns the new id.",
    tags: ["Users"],
    request: {
      params,
    },
    responses: {
      200: jsonSuccessResponse(
        provisionedStripeCustomerSchema,
        "The user's Stripe customer id",
        {
          data: { stripeCustomerId: "cus_123" },
          meta: {
            timestamp: "2025-01-01T00:00:00.000Z",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
          },
        },
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found - User not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const user = await prisma.user.findUnique({
      where: { id: resolvedUserId },
      select: { id: true, name: true, email: true, stripeCustomerId: true },
    });

    if (!user) {
      throw notFound("User not found");
    }

    if (user.stripeCustomerId) {
      return ok(
        c,
        provisionedStripeCustomerSchema.parse({
          stripeCustomerId: user.stripeCustomerId,
        }),
      );
    }

    const stripeCustomerId = await provisionUserStripeCustomer({
      email: user.email,
      name: user.name,
      id: user.id,
    });

    return ok(c, provisionedStripeCustomerSchema.parse({ stripeCustomerId }));
  });
}
