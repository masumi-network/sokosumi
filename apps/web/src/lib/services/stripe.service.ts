import "server-only";

import {
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { getOrganizationMetadata } from "@sokosumi/utils";
import { headers } from "next/headers";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { UnAuthenticatedError } from "@/lib/auth/errors";
import { verifyUserId } from "@/lib/auth/utils";
import { coreClient } from "@/lib/clients/core.client";
import { type Price, stripeClient } from "@/lib/clients/stripe.client";
import prisma from "@/lib/db/prisma";
import { CouponNotFoundError } from "@/lib/errors/coupon-errors";

export const stripeService = (() => {
  async function getStripeCustomerId(
    organizationId: string | null,
  ): Promise<string | null> {
    if (organizationId) {
      const { data } =
        await coreClient.getOrganizationStripeCustomer(organizationId);
      return data.stripeCustomerId;
    }
    const { data } = await coreClient.getMyStripeCustomer();
    return data.stripeCustomerId;
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
        let stripeCustomerId = await getStripeCustomerId(organizationId);
        if (!stripeCustomerId) {
          const customer = organizationId
            ? await this.createStripeCustomerForOrganization(organizationId)
            : await this.createStripeCustomerForUser(userId);
          if (!customer) {
            throw new Error("Stripe customer not found");
          }

          stripeCustomerId = customer.id;
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
      let stripeCustomerId = await getStripeCustomerId(scope.organizationId);

      // Create Stripe customer if doesn't exist
      if (!stripeCustomerId) {
        const customer = scope.organizationId
          ? await this.createStripeCustomerForOrganization(scope.organizationId)
          : await this.createStripeCustomerForUser(scope.userId);

        if (!customer) {
          return null;
        }
        stripeCustomerId = customer.id;
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

    async createStripeCustomerForUser(
      userId: string,
    ): Promise<Stripe.Customer | null> {
      const user = await userRepository.getUserById(userId, prisma);
      if (!user) {
        return null;
      }
      return await stripeClient.createUserCustomer(
        user.id,
        user.name,
        user.email,
      );
    },

    async createStripeCustomerForOrganization(
      organizationId: string,
    ): Promise<Stripe.Customer | null> {
      const organization =
        await organizationRepository.getOrganizationWithRelationsById(
          organizationId,
          prisma,
        );
      if (!organization) {
        return null;
      }
      const { invoiceEmail } = getOrganizationMetadata(organization.metadata);
      return await stripeClient.createOrganizationCustomer(
        organization.id,
        organization.slug,
        organization.name,
        invoiceEmail,
      );
    },

    async syncOrganizationInvoiceEmailWithStripe(
      organizationId: string,
      invoiceEmail: string | null,
    ): Promise<boolean> {
      try {
        const organization =
          await organizationRepository.getOrganizationWithRelationsById(
            organizationId,
            prisma,
          );

        if (!organization || !organization.stripeCustomerId) {
          // No Stripe customer to update
          return true;
        }

        // Update Stripe customer email
        await stripeClient.updateCustomerEmail(
          organization.stripeCustomerId,
          invoiceEmail,
        );

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

    async createAndApplyReferralCredits(
      userId: string,
      organizationId: string | null,
      referralCount: number,
    ): Promise<{
      personalCoupon?: Stripe.Coupon;
      orgCoupon?: Stripe.Coupon;
    }> {
      const user = await userRepository.getUserById(userId, prisma);
      if (!user || !user.stripeCustomerId) {
        throw new Error("User or Stripe customer not found");
      }

      const personalCoupon = await this.getCoupon(
        getEnvSecrets().STRIPE_ONBOARD_PERSONAL_COUPON,
      );

      // Scoped to user+coupon+count: retries of the same redemption replay
      // the original grant, while a later redemption with a higher referral
      // count is a legitimately distinct grant (and distinct request params).
      const personalInvoice = await stripeClient.applyInvoiceCreditsToCustomer(
        user.stripeCustomerId,
        personalCoupon.id,
        `referral-${personalCoupon.id}-user-${user.id}-${referralCount}`,
        {
          referral_user_id: String(user.id),
          referral_email: String(user.email ?? ""),
        },
        referralCount,
      );
      if (!personalInvoice || !personalInvoice?.id) {
        throw new Error("Failed to apply personal coupon");
      }

      if (personalInvoice.status !== "paid") {
        throw new Error("Personal invoice is not paid");
      }

      // Create and apply organization coupon if organizationId provided
      let orgCoupon: Stripe.Coupon | undefined;
      if (organizationId) {
        const organization =
          await organizationRepository.getOrganizationWithRelationsById(
            organizationId,
            prisma,
          );

        if (!organization) {
          throw new Error("Organization not found");
        }

        let orgStripeCustomerId = organization.stripeCustomerId;
        if (!orgStripeCustomerId) {
          const { invoiceEmail } = getOrganizationMetadata(
            organization.metadata,
          );
          const orgCustomer = await stripeClient.createOrganizationCustomer(
            organization.id,
            organization.slug,
            organization.name,
            invoiceEmail,
          );
          if (!orgCustomer) {
            throw new Error("Failed to create organization Stripe customer");
          }
          orgStripeCustomerId = orgCustomer.id;
        }

        orgCoupon = await this.getCoupon(
          getEnvSecrets().STRIPE_ONBOARD_ORGANIZATION_COUPON,
        );

        const orgInvoice = await stripeClient.applyInvoiceCreditsToCustomer(
          orgStripeCustomerId,
          orgCoupon.id,
          `referral-${orgCoupon.id}-org-${organizationId}-${referralCount}`,
          {
            referral_user_id: String(userId),
            referral_email: String(user?.email ?? ""),
          },
          referralCount,
        );
        if (!orgInvoice || !orgInvoice?.id) {
          throw new Error("Failed to apply organization coupon");
        }
        if (orgInvoice.status !== "paid") {
          throw new Error("Organization invoice is not paid");
        }
      }

      return { personalCoupon, orgCoupon };
    },
  };
})();
