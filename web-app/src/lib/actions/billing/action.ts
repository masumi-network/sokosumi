"use server";

import { getTranslations } from "next-intl/server";

import { getEnvSecrets } from "@/config/env.config";
import { getSessionOrThrow } from "@/lib/auth/utils";
import { CouponError } from "@/lib/errors/coupon-errors";
import {
  createStripeCheckoutSession,
  getCreditsForCoupon,
  getPromotionCode,
  getWelcomePromotionCode,
} from "@/lib/services";

export async function claimFreeCredits(): Promise<{
  success: boolean;
  url?: string;
  error?: string;
}> {
  try {
    const session = await getSessionOrThrow();
    const promotionCode = await getWelcomePromotionCode(session.user.id);
    if (!promotionCode) {
      return {
        success: false,
        error: "Promotion code not found",
      };
    }

    // Create the checkout session
    const { url } = await createStripeCheckoutSession(
      session.user.id,
      100,
      getEnvSecrets().STRIPE_PRICE_ID,
      promotionCode.id,
    );

    return {
      success: true,
      url,
    };
  } catch (error) {
    console.error("Failed to create checkout session:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

export async function getFreeCreditsWithCoupon(
  priceId: string,
  couponId: string,
) {
  try {
    const session = await getSessionOrThrow();

    const credits = await getCreditsForCoupon(couponId, priceId);
    // Validate and get the promotion code for this user and couponId
    const promo = await getPromotionCode(session.user.id, couponId, 1);
    if (!promo || !promo.active) {
      const t = await getTranslations("App.Billing");
      return {
        success: false,
        error: t("invalidCoupon"),
      };
    }
    const { url } = await createStripeCheckoutSession(
      session.user.id,
      credits,
      priceId,
      promo.id,
    );
    return {
      success: true,
      url,
    };
  } catch (error) {
    console.error("Failed to create checkout session:", error);

    // Handle specific coupon errors
    if (error instanceof CouponError) {
      const t = await getTranslations("App.Billing");
      let errorMessage = t("invalidCoupon"); // Default message

      switch (error.code) {
        case "COUPON_NOT_FOUND":
          errorMessage = t("couponNotFound");
          break;
        case "COUPON_TYPE_ERROR":
          errorMessage = t("couponTypeError");
          break;
        case "COUPON_CURRENCY_ERROR":
          errorMessage = t("couponCurrencyError");
          break;
        default:
          break;
      }

      return {
        success: false,
        error: errorMessage,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
export async function purchaseCredits(
  priceId: string,
  credits: number,
): Promise<{
  success: boolean;
  url?: string;
  error?: string;
}> {
  const t = await getTranslations("App.Billing");
  try {
    // Validate input
    if (!credits || credits <= 0) {
      return {
        success: false,
        error: t("invalidCredits"),
      };
    }

    const session = await getSessionOrThrow();

    // Create the checkout session
    const { url } = await createStripeCheckoutSession(
      session.user.id,
      credits,
      priceId,
    );

    return {
      success: true,
      url,
    };
  } catch {
    return {
      success: false,
      error: t("checkoutFailed"),
    };
  }
}
