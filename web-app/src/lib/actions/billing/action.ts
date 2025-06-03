"use server";

import { getEnvSecrets } from "@/config/env.config";
import { getSessionOrThrow } from "@/lib/auth/utils";
import {
  createStripeCheckoutSession,
  getWelcomePromotionCode,
} from "@/lib/services";

export async function claimFreeCredits(): Promise<{
  success: boolean;
  url?: string;
  error?: string;
}> {
  try {
    // Get the current user session
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

export async function purchaseCredits(
  credits: number,
  priceId: string,
): Promise<{
  success: boolean;
  url?: string;
  error?: string;
}> {
  try {
    // Validate input
    if (!credits || credits <= 0) {
      return {
        success: false,
        error: "Invalid credit amount",
      };
    }

    // Get the current user session
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
  } catch (error) {
    console.error("Failed to create checkout session:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
