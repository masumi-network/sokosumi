import "server-only";

import {
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { headers } from "next/headers";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { UnAuthenticatedError } from "@/lib/auth/errors";
import { verifyUserId } from "@/lib/auth/utils";
import { Price, stripeClient } from "@/lib/clients/stripe.client";
import prisma from "@/lib/db/prisma";
import { CouponNotFoundError } from "@/lib/errors/coupon-errors";
import { getSubscriptionCatalog } from "@/lib/stripe/subscription-catalog";
import { getCreditsForCoupon } from "@/lib/utils/credits";

const stripeInstance = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);
const EXISTING_FREE_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>(
  ["active", "trialing", "past_due", "unpaid", "incomplete", "paused"],
);

export type EnsureFreeSubscriptionResult =
  | {
      status: "created";
      subscriptionId: string;
    }
  | {
      status: "skipped";
      reason: string;
    }
  | {
      status: "failed";
      reason: string;
    };

export type EnsurePersonalFreeSubscriptionResult = EnsureFreeSubscriptionResult;
export type EnsureOrganizationFreeSubscriptionResult =
  EnsureFreeSubscriptionResult;

export const stripeService = (() => {
  async function getStripeCustomerId(
    userId: string,
    organizationId: string | null,
  ): Promise<string | null> {
    if (organizationId) {
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { stripeCustomerId: true },
      });
      if (!organization) {
        throw new Error("Organization not found");
      }
      return organization.stripeCustomerId;
    } else {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { stripeCustomerId: true },
      });
      if (!user) {
        throw new Error("User not found");
      }
      return user.stripeCustomerId;
    }
  }

  return {
    async createStripeCheckoutSession(
      userId: string,
      organizationId: string | null,
      credits: number,
      price: Price,
      promotionCode: string | null = null,
      returnPath: string = "/credits",
      checkoutMetadata?: Record<string, string>,
    ): Promise<{ url: string }> {
      const isVerified = await verifyUserId(userId);
      if (!isVerified) {
        throw new UnAuthenticatedError("User not authorized");
      }
      try {
        const stripeCustomerId = await getStripeCustomerId(
          userId,
          organizationId,
        );
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
          checkoutMetadata,
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
     * @param authContext - Auth context (userId, organizationId).
     * @returns {Promise<Stripe.PromotionCode>} The promotion code if successfully claimed, otherwise null.
     */
    async claimCoupon(
      couponId: string,
      maxRedemptions: number = 1,
      authContext: { userId: string; organizationId: string | null },
      metadata?: Record<string, string>,
    ): Promise<Stripe.PromotionCode | null> {
      let stripeCustomerId = await getStripeCustomerId(
        authContext.userId,
        authContext.organizationId,
      );

      // Create Stripe customer if doesn't exist
      if (!stripeCustomerId) {
        const customer = authContext.organizationId
          ? await this.createStripeCustomerForOrganization(
              authContext.organizationId,
            )
          : await this.createStripeCustomerForUser(authContext.userId);

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

    async getCreditsForCoupon(couponId: string): Promise<number> {
      const coupon = await stripeClient.getCouponById(couponId);
      if (!coupon) {
        throw new CouponNotFoundError(couponId);
      }
      return getCreditsForCoupon(coupon);
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

    async ensurePersonalFreeSubscription(
      userId: string,
    ): Promise<EnsurePersonalFreeSubscriptionResult> {
      try {
        const user = await userRepository.getUserById(userId, prisma);
        if (!user) {
          return {
            status: "failed",
            reason: "USER_NOT_FOUND",
          };
        }

        let stripeCustomerId = user.stripeCustomerId;
        if (!stripeCustomerId) {
          const customer = await this.createStripeCustomerForUser(userId);
          if (!customer) {
            return {
              status: "failed",
              reason: "CUSTOMER_CREATION_FAILED",
            };
          }
          stripeCustomerId = customer.id;
          await prisma.user.update({
            where: { id: userId },
            data: { stripeCustomerId },
          });
        }

        const existingSubscriptions =
          await stripeClient.listSubscriptions(stripeCustomerId);
        const hasExistingPersonalSubscription = existingSubscriptions.some(
          (subscription) =>
            EXISTING_FREE_SUBSCRIPTION_STATUSES.has(subscription.status),
        );

        if (hasExistingPersonalSubscription) {
          return {
            status: "skipped",
            reason: "ALREADY_HAS_SUBSCRIPTION",
          };
        }

        let freePlanPriceId: string;
        try {
          const subscriptionCatalog =
            await getSubscriptionCatalog(stripeInstance);
          freePlanPriceId = subscriptionCatalog.free.priceId;
        } catch (error) {
          console.error(
            `Invalid free subscription plan configuration for user ${userId}:`,
            error,
          );
          return {
            status: "failed",
            reason: "INVALID_FREE_PLAN_CONFIGURATION",
          };
        }

        const subscription = await stripeClient.createSubscription(
          stripeCustomerId,
          freePlanPriceId,
          1,
          { referenceId: userId, userId },
          `free-plan-user-${userId}`,
        );

        return {
          status: "created",
          subscriptionId: subscription.id,
        };
      } catch (error) {
        console.error(
          `Failed to ensure personal free subscription for user ${userId}:`,
          error,
        );
        return {
          status: "failed",
          reason: "SUBSCRIPTION_ENROLLMENT_FAILED",
        };
      }
    },

    async ensureOrganizationFreeSubscription(
      organizationId: string,
    ): Promise<EnsureOrganizationFreeSubscriptionResult> {
      try {
        const organization =
          await organizationRepository.getOrganizationWithRelationsById(
            organizationId,
            prisma,
          );
        if (!organization) {
          return {
            status: "failed",
            reason: "ORGANIZATION_NOT_FOUND",
          };
        }

        let stripeCustomerId = organization.stripeCustomerId;
        if (!stripeCustomerId) {
          const customer =
            await this.createStripeCustomerForOrganization(organizationId);
          if (!customer) {
            return {
              status: "failed",
              reason: "CUSTOMER_CREATION_FAILED",
            };
          }
          stripeCustomerId = customer.id;
          await prisma.organization.update({
            where: { id: organizationId },
            data: { stripeCustomerId },
          });
        }

        const existingSubscriptions =
          await stripeClient.listSubscriptions(stripeCustomerId);
        const hasExistingOrganizationSubscription = existingSubscriptions.some(
          (subscription) =>
            EXISTING_FREE_SUBSCRIPTION_STATUSES.has(subscription.status),
        );

        if (hasExistingOrganizationSubscription) {
          return {
            status: "skipped",
            reason: "ALREADY_HAS_SUBSCRIPTION",
          };
        }

        let freePlanPriceId: string;
        try {
          const subscriptionCatalog =
            await getSubscriptionCatalog(stripeInstance);
          freePlanPriceId = subscriptionCatalog.free.priceId;
        } catch (error) {
          console.error(
            `Invalid free subscription plan configuration for organization ${organizationId}:`,
            error,
          );
          return {
            status: "failed",
            reason: "INVALID_FREE_PLAN_CONFIGURATION",
          };
        }

        const organizationMemberCount = await prisma.member.count({
          where: {
            organizationId,
          },
        });
        const seats = Math.max(organizationMemberCount, 1);

        const subscription = await stripeClient.createSubscription(
          stripeCustomerId,
          freePlanPriceId,
          seats,
          { referenceId: organizationId, organizationId },
          `free-plan-organization-${organizationId}`,
        );

        return {
          status: "created",
          subscriptionId: subscription.id,
        };
      } catch (error) {
        console.error(
          `Failed to ensure organization free subscription for organization ${organizationId}:`,
          error,
        );
        return {
          status: "failed",
          reason: "SUBSCRIPTION_ENROLLMENT_FAILED",
        };
      }
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
      return await stripeClient.createOrganizationCustomer(
        organization.id,
        organization.slug,
        organization.name,
        organization.invoiceEmail,
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

    async claimWelcomeCoupon(
      userId: string,
    ): Promise<{ couponApplied: boolean; invoiceId: string | null }> {
      const welcomeCouponId = getEnvSecrets().STRIPE_WELCOME_COUPON;

      try {
        const user = await userRepository.getUserById(userId, prisma);
        if (!user) {
          throw new Error("User not found");
        }
        if (!user.stripeCustomerId) {
          throw new Error("User does not have a stripe customer id");
        }

        const coupon = await this.getCoupon(welcomeCouponId);
        const invoice = await stripeClient.applyInvoiceCreditsToCustomer(
          user.stripeCustomerId,
          coupon.id,
          {
            redemption_type: "welcome_coupon",
            welcome_source: "customer.created",
            user_id: user.id,
            user_email: user.email ?? "",
          },
        );

        if (!invoice?.id) {
          throw new Error("Failed to apply welcome coupon");
        }
        if (invoice.status !== "paid") {
          throw new Error("Welcome coupon invoice is not paid");
        }

        return { couponApplied: true, invoiceId: invoice.id };
      } catch (error) {
        console.error(
          `Failed to claim welcome coupon for user ${userId}:`,
          error,
        );
        return { couponApplied: false, invoiceId: null };
      }
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

      const personalInvoice = await stripeClient.applyInvoiceCreditsToCustomer(
        user.stripeCustomerId,
        personalCoupon.id,
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
          const orgCustomer = await stripeClient.createOrganizationCustomer(
            organization.id,
            organization.slug,
            organization.name,
            organization.invoiceEmail,
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
