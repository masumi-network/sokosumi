import { createRoute, z } from "@hono/zod-openapi";

import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  claimCouponSchema,
  claimedPromotionCodeSchema,
} from "@/schemas/billing.schema";
import { stripeBillingService } from "@/services/stripe-billing.service";

const params = z.object({
  couponId: z.string().openapi({
    param: { name: "couponId", in: "path" },
    description: "Stripe coupon id",
    example: "coupon_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{couponId}/claim",
  operationId: "claimCoupon",
  description:
    "Claim a coupon by creating or reusing a customer-scoped Stripe promotion code.",
  tags: ["Coupons"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: claimCouponSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      claimedPromotionCodeSchema,
      "Claimed promotion code",
      {
        data: {
          promotionCodeId: "promo_123",
          active: true,
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
    const { couponId } = c.req.valid("param");
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

    const promotionCode = await stripeBillingService.claimCoupon({
      userId: userContext.userId,
      organizationId,
      couponId,
    });

    return created(c, claimedPromotionCodeSchema.parse(promotionCode));
  });
}
