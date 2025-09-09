"use server";

import { getEnvSecrets } from "@/config/env.secrets";
import {
  ActionError,
  BillingErrorCode,
  CommonErrorCode,
} from "@/lib/actions/errors";
import { stripeClient } from "@/lib/clients/stripe.client";
import { CouponError } from "@/lib/errors/coupon-errors";
import { userService } from "@/lib/services";
import { stripeService } from "@/lib/services/stripe.service";
import { Err, Ok, Result } from "@/lib/ts-res";
import {
  AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";

interface ClaimFreeCreditsParameters extends AuthenticatedRequest {
  promotionCode: string;
}

export const claimFreeCredits = withAuthContext<
  ClaimFreeCreditsParameters,
  Result<{ url: string }, ActionError>
>(async ({ promotionCode, authContext }) => {
  const { userId } = authContext;

  try {
    const price = await stripeClient.getPriceByProductId(
      getEnvSecrets().STRIPE_PRODUCT_ID,
    );
    const credits = await stripeService.getCreditsForPromotionCode(
      promotionCode,
      price,
    );

    // Create the checkout session
    const { url } = await stripeService.createStripeCheckoutSession(
      userId,
      null,
      credits,
      price,
      promotionCode,
    );

    return Ok({ url });
  } catch (error) {
    console.error("Failed to claim free credits", error);
    if (error instanceof CouponError) {
      return Err({
        code: error.code,
      });
    }
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});

interface PurchaseCreditsParameters extends AuthenticatedRequest {
  organizationId: string | null;
  priceId: string;
  credits: number;
}

export const purchaseCredits = withAuthContext<
  PurchaseCreditsParameters,
  Result<{ url: string }, ActionError>
>(async ({ organizationId, priceId, credits, authContext }) => {
  const { userId } = authContext;

  // Validate input
  if (!credits || credits <= 0) {
    return Err({
      message: "Invalid credits",
      code: BillingErrorCode.INVALID_CREDITS,
    });
  }

  // Verify user is member of the organization
  if (organizationId) {
    const member = await userService.getMyMemberInOrganization(organizationId);
    if (!member) {
      return Err({
        message: "Unauthorized",
        code: CommonErrorCode.UNAUTHORIZED,
      });
    }
  }

  try {
    // Fetch price server-side
    const price = await stripeClient.getPriceById(priceId);

    // Create the checkout session
    const { url } = await stripeService.createStripeCheckoutSession(
      userId,
      organizationId,
      credits,
      price,
    );

    return Ok({ url });
  } catch (error) {
    console.error("Failed to purchase credits", error);
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});

interface GetFreeCreditsWithCouponParameters extends AuthenticatedRequest {
  organizationId: string | null;
  priceId: string;
  couponId: string;
}

export const getFreeCreditsWithCoupon = withAuthContext<
  GetFreeCreditsWithCouponParameters,
  Result<{ url: string }, ActionError>
>(async ({ organizationId, priceId, couponId, authContext }) => {
  const { userId } = authContext;

  // If organizationId is provided, verify user is a member
  if (organizationId) {
    const member = await userService.getMyMemberInOrganization(organizationId);
    if (!member) {
      return Err({
        message: "Unauthorized",
        code: CommonErrorCode.UNAUTHORIZED,
      });
    }
  }

  try {
    // Fetch price server-side
    const price = await stripeClient.getPriceById(priceId);
    const credits = await stripeService.getCreditsForCoupon(couponId, price);

    // Validate and get the promotion code for this user and couponId
    const promo = await stripeService.getPromotionCode(couponId, 1);
    if (!promo || !promo.active) {
      return Err({
        message: "Invalid coupon",
        code: BillingErrorCode.INVALID_COUPON,
      });
    }

    // Create the checkout session (for org if orgId provided, else personal)
    const { url } = await stripeService.createStripeCheckoutSession(
      userId,
      organizationId ?? null,
      credits,
      price,
      promo.id,
    );
    return Ok({ url });
  } catch (error) {
    console.error("Failed to get free credits with coupon", error);
    if (error instanceof CouponError) {
      return Err({
        code: error.code,
      });
    }
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});
