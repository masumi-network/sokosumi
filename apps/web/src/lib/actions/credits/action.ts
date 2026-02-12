"use server";

import {
  ActionError,
  CommonErrorCode,
  CreditsErrorCode,
} from "@/lib/actions/errors";
import { stripeClient } from "@/lib/clients/stripe.client";
import { CouponError } from "@/lib/errors/coupon-errors";
import { userService } from "@/lib/services";
import { stripeService } from "@/lib/services/stripe.service";
import { isStripeUnitAlignedCredits } from "@/lib/stripe/credit-topup-pricing";
import { Err, Ok, Result } from "@/lib/ts-res";
import {
  AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";

interface PurchaseCreditsParameters extends AuthenticatedRequest {
  organizationId: string | null;
  credits: number;
}

export const purchaseCredits = withAuthContext<
  PurchaseCreditsParameters,
  Result<{ url: string }, ActionError>
>(async ({ organizationId, credits, authContext }) => {
  const { userId } = authContext;

  // Validate input
  if (!isStripeUnitAlignedCredits(credits)) {
    return Err({
      message: "Invalid credits",
      code: CreditsErrorCode.INVALID_CREDITS,
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
    const price = await stripeClient.getCreditTopUpPriceByCredits(credits);

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

interface ClaimFreeCreditsWithCouponParameters extends AuthenticatedRequest {
  organizationId: string | null;
  couponId: string;
}

export const claimFreeCreditsWithCoupon = withAuthContext<
  ClaimFreeCreditsWithCouponParameters,
  Result<{ url: string }, ActionError>
>(async ({ organizationId, couponId, authContext }) => {
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
    const credits = await stripeService.getCreditsForCoupon(couponId);
    const promo = await stripeService.claimCoupon(couponId, 1, {
      userId,
      organizationId,
    });
    if (!promo || !promo.active) {
      return Err({
        message: "Invalid coupon",
        code: CreditsErrorCode.INVALID_COUPON,
      });
    }
    const price = await stripeClient.getBaseCreditTopUpPrice();

    // Create the checkout session (for org if orgId provided, else personal)
    const { url } = await stripeService.createStripeCheckoutSession(
      userId,
      organizationId,
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
