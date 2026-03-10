"use server";

import {
  ActionError,
  CommonErrorCode,
  CreditsErrorCode,
} from "@/lib/actions/errors";
import { resolveZeroMarginTopUpLookupKey } from "@/lib/flags/zero-margin-top-up";
import { stripeClient } from "@/lib/clients/stripe.client";
import { CouponError } from "@/lib/errors/coupon-errors";
import { userService } from "@/lib/services";
import { stripeService } from "@/lib/services/stripe.service";
import { isPositiveIntegerCredits } from "@/lib/stripe/credit-topup-pricing";
import { Err, Ok, Result } from "@/lib/ts-res";
import { getCreditsForCoupon } from "@/lib/utils/credits";
import {
  AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface PurchaseCreditsParameters extends AuthenticatedRequest {
  organizationId: string | null;
  credits: number;
  returnPath?: string;
}

export const purchaseCredits = withSession<
  PurchaseCreditsParameters,
  Result<{ url: string }, ActionError>
>(async ({ organizationId, credits, session, returnPath }) => {
  const userId = session.user.id;

  // Validate input
  if (!isPositiveIntegerCredits(credits)) {
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
    const priceLookupKeyOverride = resolveZeroMarginTopUpLookupKey(
      session.user.email,
    );
    const price = priceLookupKeyOverride
      ? await stripeClient.getCreditTopUpPriceByCredits(
          credits,
          priceLookupKeyOverride,
        )
      : await stripeClient.getCreditTopUpPriceByCredits(credits);

    // Create the checkout session
    const { url } = await stripeService.createStripeCheckoutSession(
      userId,
      organizationId,
      credits,
      price,
      null,
      returnPath,
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
  returnPath?: string;
}

export const claimFreeCreditsWithCoupon = withSession<
  ClaimFreeCreditsWithCouponParameters,
  Result<{ url: string }, ActionError>
>(async ({ organizationId, couponId, session, returnPath }) => {
  const userId = session.user.id;

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
    const coupon = await stripeService.getCoupon(couponId);
    const credits = getCreditsForCoupon(coupon);
    const couponTtlDays = coupon.metadata?.ttl_days;
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
      returnPath ?? "/coupon",
      couponTtlDays ?? undefined,
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
