import { createRoute, z } from "@hono/zod-openapi";

import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { couponDetailsSchema } from "@/schemas/billing.schema";
import {
  CouponNotFoundError,
  CouponTypeError,
  stripeBillingService,
} from "@/services/stripe-billing.service";

const params = z.object({
  couponId: z.string().openapi({
    param: { name: "couponId", in: "path" },
    description: "Stripe coupon id",
    example: "coupon_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{couponId}",
  operationId: "getCouponDetails",
  description:
    "Validate a Stripe coupon for credit grants. Requires percent_off and metadata.credits.",
  tags: ["Coupons"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(couponDetailsSchema, "Coupon details", {
      data: {
        id: "coupon_123",
        percentOff: 100,
        credits: 100,
        ttlDays: "30",
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireUserContext(c.var.authContext);
    const { couponId } = c.req.valid("param");

    try {
      const coupon = await stripeBillingService.getCouponDetails(couponId);
      return ok(c, couponDetailsSchema.parse(coupon));
    } catch (error) {
      if (error instanceof CouponNotFoundError) {
        throw notFound(error.message);
      }
      if (error instanceof CouponTypeError) {
        throw badRequest(error.message);
      }
      throw error;
    }
  });
}
