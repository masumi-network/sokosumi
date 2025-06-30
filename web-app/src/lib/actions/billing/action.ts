"use server";

import { getTranslations } from "next-intl/server";

import { getEnvSecrets } from "@/config/env.secrets";
import {
  ActionError,
  BillingErrorCode,
  CommonErrorCode,
} from "@/lib/actions/types";
import { getSessionOrThrow } from "@/lib/auth/utils";
import { CouponError } from "@/lib/errors/coupon-errors";
import {
  createStripeCheckoutSession,
  getCreditsForCoupon,
  getPromotionCode,
  getWelcomePromotionCode,
} from "@/lib/services";
import { Err, Ok, Result } from "@/lib/ts-res";

export async function claimFreeCredits(): Promise<
  Result<{ url: string }, ActionError>
> {
  const t = await getTranslations("App.Billing");
  try {
    const session = await getSessionOrThrow();
    const promotionCode = await getWelcomePromotionCode(session.user.id);
    if (!promotionCode) {
      return Err({
        message: t("Errors.promotionCodeNotFound"),
        code: BillingErrorCode.PROMOTION_CODE_NOT_FOUND,
      });
    }

    // Create the checkout session
    const { url } = await createStripeCheckoutSession(
      session.user.id,
      100,
      getEnvSecrets().STRIPE_PRICE_ID,
      promotionCode.id,
    );

    return Ok({ url });
  } catch (error) {
    console.error("Failed to claim free credits:", error);
    return Err({
      message: t("Errors.freeClaimError"),
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}

export async function getFreeCreditsWithCoupon(
  priceId: string,
  couponId: string,
): Promise<Result<{ url: string }, ActionError>> {
  const t = await getTranslations("App.Billing");

  try {
    const session = await getSessionOrThrow();

    const credits = await getCreditsForCoupon(couponId, priceId);
    // Validate and get the promotion code for this user and couponId
    const promo = await getPromotionCode(session.user.id, couponId, 1);
    if (!promo || !promo.active) {
      return Err({
        message: t("Errors.invalidCoupon"),
        code: BillingErrorCode.INVALID_COUPON,
      });
    }
    const { url } = await createStripeCheckoutSession(
      session.user.id,
      credits,
      priceId,
      promo.id,
    );
    return Ok({ url });
  } catch (error) {
    console.error("Failed to get free credits with coupon:", error);

    // Handle specific coupon errors
    if (error instanceof CouponError) {
      const t = await getTranslations("App.Billing");
      let errorMessage = t("Errors.invalidCoupon"); // Default message

      switch (error.code) {
        case "COUPON_NOT_FOUND":
          errorMessage = t("Errors.couponNotFound");
          break;
        case "COUPON_TYPE_ERROR":
          errorMessage = t("Errors.couponTypeError");
          break;
        case "COUPON_CURRENCY_ERROR":
          errorMessage = t("Errors.couponCurrencyError");
          break;
        default:
          break;
      }

      return Err({
        message: errorMessage,
        code: BillingErrorCode.INVALID_COUPON,
      });
    }

    return Err({
      message: t("Error.title"),
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}
export async function purchaseCredits(
  priceId: string,
  credits: number,
): Promise<Result<{ url: string }, ActionError>> {
  const t = await getTranslations("App.Billing");
  try {
    // Validate input
    if (!credits || credits <= 0) {
      return Err({
        message: t("Errors.invalidCredits"),
        code: BillingErrorCode.INVALID_CREDITS,
      });
    }

    const session = await getSessionOrThrow();

    // Create the checkout session
    const { url } = await createStripeCheckoutSession(
      session.user.id,
      credits,
      priceId,
    );

    return Ok({ url });
  } catch (error) {
    console.error("Failed to purchase credits:", error);
    return Err({
      message: t("Error.title"),
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
}
