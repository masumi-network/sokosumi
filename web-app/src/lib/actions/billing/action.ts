"use server";

import { getEnvSecrets } from "@/config/env.secrets";
import {
  ActionError,
  BillingErrorCode,
  CommonErrorCode,
} from "@/lib/actions/errors";
import { getAuthContext } from "@/lib/auth/utils";
import { stripeClient } from "@/lib/clients/stripe.client";
import { CouponError } from "@/lib/errors/coupon-errors";
import { userService } from "@/lib/services";
import { stripeService } from "@/lib/services/stripe.service";
import { Err, Ok, Result } from "@/lib/ts-res";

export async function claimFreeCredits(
  promotionCode: string,
): Promise<Result<{ url: string }, ActionError>> {
  const context = await getAuthContext();
  if (!context) {
    return Err({
      message: "Unauthenticated",
      code: CommonErrorCode.UNAUTHENTICATED,
    });
  }

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
      context.userId,
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
}

export async function purchaseCredits(
  organizationId: string | null,
  priceId: string,
  credits: number,
): Promise<Result<{ url: string }, ActionError>> {
  const context = await getAuthContext();
  if (!context) {
    return Err({
      message: "Unauthenticated",
      code: CommonErrorCode.UNAUTHENTICATED,
    });
  }

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
      context.userId,
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
}

export async function getFreeCreditsWithCoupon(
  organizationId: string | null,
  priceId: string,
  couponId: string,
): Promise<Result<{ url: string }, ActionError>> {
  const context = await getAuthContext();
  if (!context) {
    return Err({
      message: "Unauthenticated",
      code: CommonErrorCode.UNAUTHENTICATED,
    });
  }

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
      context.userId,
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
}
