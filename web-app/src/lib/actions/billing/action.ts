"use server";

import { getEnvSecrets } from "@/config/env.secrets";
import { ActionError, BillingErrorCode, CommonErrorCode } from "@/lib/actions";
import { getSession } from "@/lib/auth/utils";
import { CouponError } from "@/lib/errors/coupon-errors";
import {
  createStripeCheckoutSession,
  getCreditsForCoupon,
  getMyMemberInOrganization,
  getPriceFromPriceId,
  getPriceFromProductId,
  getPromotionCode,
  getWelcomePromotionCode,
} from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";

export async function claimFreeCredits(): Promise<
  Result<{ url: string }, ActionError>
> {
  try {
    const session = await getSession();
    if (!session) {
      return Err({
        message: "Unauthenticated",
        code: CommonErrorCode.UNAUTHENTICATED,
      });
    }

    const promotionCode = await getWelcomePromotionCode(session.user.id);
    if (!promotionCode) {
      return Err({
        message: "Promotion code not found",
        code: BillingErrorCode.PROMOTION_CODE_NOT_FOUND,
      });
    }

    const price = await getPriceFromProductId(
      getEnvSecrets().STRIPE_PRODUCT_ID,
    );

    // Create the checkout session
    const { url } = await createStripeCheckoutSession(
      session.user.id,
      null,
      100,
      price,
      promotionCode.id,
    );

    return Ok({ url });
  } catch (error) {
    console.error("Failed to claim free credits:", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}

export async function purchaseCredits(
  organizationId: string | null,
  priceId: string,
  credits: number,
): Promise<Result<{ url: string }, ActionError>> {
  try {
    const session = await getSession();
    if (!session) {
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
      const member = await getMyMemberInOrganization(organizationId);
      if (!member) {
        return Err({
          message: "Unauthorized",
          code: CommonErrorCode.UNAUTHORIZED,
        });
      }
    }

    // Fetch price server-side
    const price = await getPriceFromPriceId(priceId);

    // Create the checkout session
    const { url } = await createStripeCheckoutSession(
      session.user.id,
      organizationId,
      credits,
      price,
    );

    return Ok({ url });
  } catch (error) {
    console.error("Failed to purchase credits:", error);
    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}

export async function getFreeCreditsWithCoupon(
  organizationId: string | null,
  priceId: string,
  couponId: string,
): Promise<Result<{ url: string }, ActionError>> {
  try {
    const session = await getSession();
    if (!session) {
      return Err({
        message: "Unauthenticated",
        code: CommonErrorCode.UNAUTHENTICATED,
      });
    }

    // If organizationId is provided, verify user is a member
    if (organizationId) {
      const member = await getMyMemberInOrganization(organizationId);
      if (!member) {
        return Err({
          message: "Unauthorized",
          code: CommonErrorCode.UNAUTHORIZED,
        });
      }
    }

    // Fetch price server-side
    const price = await getPriceFromPriceId(priceId);
    const credits = await getCreditsForCoupon(couponId, price);

    // Validate and get the promotion code for this user and couponId
    const promo = await getPromotionCode(session.user.id, couponId, 1);
    if (!promo || !promo.active) {
      return Err({
        message: "Invalid coupon",
        code: BillingErrorCode.INVALID_COUPON,
      });
    }

    // Create the checkout session (for org if orgId provided, else personal)
    const { url } = await createStripeCheckoutSession(
      session.user.id,
      organizationId ?? null,
      credits,
      price,
      promo.id,
    );
    return Ok({ url });
  } catch (error) {
    console.error("Failed to get free credits with coupon:", error);

    // Handle specific coupon errors
    if (error instanceof CouponError) {
      let errorCode = BillingErrorCode.INVALID_COUPON;

      switch (error.code) {
        case "COUPON_NOT_FOUND":
          errorCode = BillingErrorCode.COUPON_NOT_FOUND;
          break;
        case "COUPON_TYPE_ERROR":
          errorCode = BillingErrorCode.COUPON_TYPE_ERROR;
          break;
        case "COUPON_CURRENCY_ERROR":
          errorCode = BillingErrorCode.COUPON_CURRENCY_ERROR;
          break;
        default:
          break;
      }

      return Err({
        message: error.message,
        code: errorCode,
      });
    }

    return Err({
      message: "Internal server error",
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}
