"use server";

import { getEnvSecrets } from "@/config/env.config";
import { getSessionUser } from "@/lib/auth/utils";
import { convertCreditsToCents, getUserById } from "@/lib/db";
import { createStripeCheckoutSession } from "@/lib/services";

export async function claimFreeCredits(): Promise<{
  success: boolean;
  url?: string;
  error?: string;
}> {
  try {
    // Get the current user session
    const sessionUser = await getSessionUser();

    // Get the full user from database to check stripeCustomerId
    const user = await getUserById(sessionUser.id);
    if (!user) {
      return {
        success: false,
        error: "User not found",
      };
    }

    // Check if the user already has a Stripe customer ID (coupon is only for new users)
    if (user.stripeCustomerId) {
      return {
        success: false,
        error: "User already has a stripe customer id",
      };
    }

    // Create the checkout session
    const { url } = await createStripeCheckoutSession(
      user.id,
      convertCreditsToCents(100),
      getEnvSecrets().STRIPE_PRICE_ID,
      getEnvSecrets().STRIPE_WELCOME_COUPON,
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
    const sessionUser = await getSessionUser();

    // Create the checkout session
    const { url } = await createStripeCheckoutSession(
      sessionUser.id,
      convertCreditsToCents(credits),
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
