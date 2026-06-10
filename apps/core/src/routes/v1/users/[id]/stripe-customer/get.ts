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
import { stripeCustomerSchema } from "@/schemas/stripe.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/stripe-customer",
    description:
      "Get the Stripe customer id for a user (path `me` for the session user, or a user id the caller may access). `stripeCustomerId` is null when no Stripe customer has been provisioned yet.",
    tags: ["Users"],
    request: {
      params,
    },
    responses: {
      200: jsonSuccessResponse(
        stripeCustomerSchema,
        "The user's Stripe customer id (null when not provisioned)",
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
      select: { stripeCustomerId: true },
    });

    if (!user) {
      throw notFound("User not found");
    }

    return ok(
      c,
      stripeCustomerSchema.parse({ stripeCustomerId: user.stripeCustomerId }),
    );
  });
}
