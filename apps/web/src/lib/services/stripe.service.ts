import "server-only";

import { userRepository } from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { headers } from "next/headers";
import type Stripe from "stripe";

import { UnAuthenticatedError } from "@/lib/auth/errors";
import { verifyUserId } from "@/lib/auth/utils";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import { type Price, stripeClient } from "@/lib/clients/stripe.client";
import prisma from "@/lib/db/prisma";
import { CouponNotFoundError } from "@/lib/errors/coupon-errors";

function isEntityNotFoundError(error: unknown): boolean {
  return (
    error instanceof CoreApiRequestError &&
    (error.kind === CORE_API_ERROR_KINDS.ORGANIZATION_NOT_FOUND ||
      error.status === 404)
  );
}

export const stripeService = (() => {
  /**
   * Ensures a Stripe customer exists for the current session user or the
   * given organization and returns its id. Core creates the customer when
   * missing; persistence of the id happens via the `customer.created`
   * webhook. Returns null when the user/organization does not exist.
   */
  async function ensureStripeCustomerId(
    organizationId: string | null,
  ): Promise<string | null> {
    try {
      const { data } = organizationId
        ? await coreClient.createOrganizationStripeCustomer(organizationId)
        : await coreClient.createMyStripeCustomer();
      return data.stripeCustomerId;
    } catch (error) {
      if (isEntityNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  return {
    async createStripeCheckoutSession(
      userId: string,
      organizationId: string | null,
      credits: number,
      price: Price,
      promotionCode: string | null = null,
      returnPath: string = "/billing?tab=credits",
      ttlDays?: string,
    ): Promise<{ url: string }> {
      const isVerified = await verifyUserId(userId);
      if (!isVerified) {
        throw new UnAuthenticatedError("User not authorized");
      }
      try {
        const stripeCustomerId = await ensureStripeCustomerId(organizationId);
        if (!stripeCustomerId) {
          throw new Error("Stripe customer not found");
        }

        const headerList = await headers();
        const checkoutSession = await stripeClient.createCheckoutSession(
          stripeCustomerId,
          userId,
          organizationId,
          credits,
          price,
          headerList.get("origin"),
          promotionCode,
          returnPath,
          ttlDays,
        );

        if (!checkoutSession.url) {
          throw new Error("Failed to create checkout session");
        }

        return { url: checkoutSession.url };
      } catch (error) {
        console.log("Error creating stripe checkout session", error);
        throw error;
      }
    },

    /**
     * Claims a coupon for the current user by creating/retrieving a promotion code.
     * This function handles the actual claiming process and prevents duplicate promotion codes.
     *
     * @param couponId - The ID of the coupon to claim
     * @param maxRedemptions - Maximum number of times this promotion code can be redeemed (default: 1)
     * @param metadata - Optional metadata to attach to the promotion code
     * @param scope - Caller identity scope (userId, organizationId).
     * @returns {Promise<Stripe.PromotionCode>} The promotion code if successfully claimed, otherwise null.
     */
    async claimCoupon(
      couponId: string,
      maxRedemptions: number = 1,
      scope: { userId: string; organizationId: string | null },
      metadata?: Record<string, string>,
    ): Promise<Stripe.PromotionCode | null> {
      const stripeCustomerId = await ensureStripeCustomerId(
        scope.organizationId,
      );
      if (!stripeCustomerId) {
        return null;
      }

      try {
        // Check if promotion code already exists (idempotency)
        const existingPromotionCode = await stripeClient.getPromotionCode(
          stripeCustomerId,
          couponId,
        );
        if (existingPromotionCode) {
          return existingPromotionCode; // Return existing, don't create duplicate
        }

        // Create new promotion code
        const promotionCode = await stripeClient.createPromotionCode(
          stripeCustomerId,
          couponId,
          maxRedemptions,
          metadata,
        );

        return promotionCode;
      } catch (error) {
        console.error("Error in claimCoupon:", error);

        // If creation failed due to race condition, try to fetch existing one
        try {
          return await stripeClient.getPromotionCode(
            stripeCustomerId,
            couponId,
          );
        } catch {
          return null;
        }
      }
    },

    async syncOrganizationInvoiceEmailWithStripe(
      organizationId: string,
      invoiceEmail: string | null,
    ): Promise<boolean> {
      try {
        let stripeCustomerId: string | null;
        try {
          const { data } =
            await coreClient.getOrganizationStripeCustomer(organizationId);
          stripeCustomerId = data.stripeCustomerId;
        } catch (error) {
          if (isEntityNotFoundError(error)) {
            // No organization to update
            return true;
          }
          throw error;
        }

        if (!stripeCustomerId) {
          // No Stripe customer to update
          return true;
        }

        // Update Stripe customer email
        await stripeClient.updateCustomerEmail(stripeCustomerId, invoiceEmail);

        return true;
      } catch (error) {
        console.error(
          `Error syncing invoice email with Stripe for organization ${organizationId}:`,
          error,
        );
        return false;
      }
    },

    async syncUserEmailWithStripe(
      userId: string,
      newEmail: string,
    ): Promise<boolean> {
      try {
        const user = await userRepository.getUserById(userId, prisma);

        if (!user || !user.stripeCustomerId) {
          // No Stripe customer to update
          return true;
        }

        // Update Stripe customer email
        await stripeClient.updateCustomerEmail(user.stripeCustomerId, newEmail);

        console.log(
          `✅ Synced user ${userId} email to Stripe customer ${user.stripeCustomerId}`,
        );

        return true;
      } catch (error) {
        console.error(
          `Error syncing user email with Stripe for user ${userId}:`,
          error,
        );
        return false;
      }
    },

    async getCoupon(couponId: string): Promise<Stripe.Coupon> {
      const coupon = await stripeClient.getCouponById(couponId);
      if (!coupon) {
        throw new CouponNotFoundError(couponId);
      }
      return coupon;
    },
  };
})();
