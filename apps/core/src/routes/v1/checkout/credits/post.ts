import { createRoute } from "@hono/zod-openapi";

import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  createCreditCheckoutSessionSchema,
  creditCheckoutSessionSchema,
} from "@/schemas/billing.schema";
import { stripeBillingService } from "@/services/stripe-billing.service";

const route = createRoute({
  method: "post",
  path: "/credits",
  operationId: "createCreditCheckoutSession",
  description:
    "Create a Stripe Checkout session for a one-time credit top-up. Ensures the billing customer exists before redirecting to Stripe.",
  tags: ["Checkout"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createCreditCheckoutSessionSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      creditCheckoutSessionSchema,
      "Checkout session URL",
      {
        data: {
          url: "https://checkout.stripe.com/c/pay/cs_test_123",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
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
    const userContext = requireUserContext(c.var.authContext);
    const body = c.req.valid("json");
    const organizationId = body.organizationId ?? null;

    if (organizationId) {
      try {
        await resolveMemberOrganizationById({
          id: organizationId,
          userId: userContext.userId,
          tx: prisma,
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          throw notFound("Organization not found");
        }
        throw forbidden("You are not a member of this organization");
      }
    }

    const session = await stripeBillingService.createCreditCheckoutSession({
      userId: userContext.userId,
      organizationId,
      credits: body.credits,
      returnPath: body.returnPath,
      promotionCodeId: body.promotionCodeId ?? null,
    });

    return created(c, creditCheckoutSessionSchema.parse(session));
  });
}
