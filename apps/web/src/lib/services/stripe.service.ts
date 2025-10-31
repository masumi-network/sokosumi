import "server-only";

import * as Sentry from "@sentry/nextjs";
import prisma from "@sokosumi/database/client";
import {
  fiatTransactionRepository,
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { headers } from "next/headers";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { UnAuthenticatedError } from "@/lib/auth/errors";
import { getAuthContext, verifyUserId } from "@/lib/auth/utils";
import { Price, stripeClient } from "@/lib/clients/stripe.client";
import {
  CouponCurrencyError,
  CouponNotFoundError,
  CouponTypeError,
} from "@/lib/errors/coupon-errors";
import { convertCreditsToCents } from "@/lib/helpers/credit";

export const stripeService = (() => {
  async function getStripeCustomerId(
    userId: string,
    organizationId: string | null,
  ): Promise<string | null> {
    if (organizationId) {
      const organization =
        await organizationRepository.getOrganizationWithRelationsById(
          organizationId,
        );
      if (!organization) throw new Error("Organization not found");
      return organization.stripeCustomerId;
    } else {
      const user = await userRepository.getUserById(userId);
      if (!user) throw new Error("User not found");
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

        const amount = credits * price.amountPerCredit;

        // Transaction only for fiat transaction creation and update
        const checkoutSession = await prisma.$transaction(async (tx) => {
          const fiatTransaction =
            await fiatTransactionRepository.createFiatTransaction(
              userId,
              organizationId,
              convertCreditsToCents(credits),
              amount,
              price.currency,
              tx,
            );

          const headerList = await headers();
          const checkoutSession = await stripeClient.createCheckoutSession(
            stripeCustomerId,
            fiatTransaction,
            price,
            headerList.get("origin"),
            promotionCode,
          );

          await fiatTransactionRepository.setFiatTransactionServicePaymentId(
            fiatTransaction.id,
            checkoutSession.id,
            tx,
          );

          return checkoutSession;
        });

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
     * @returns {Promise<Stripe.PromotionCode | null>} The promotion code if successfully claimed, otherwise null.
     */
    async claimCoupon(
      couponId: string,
      maxRedemptions: number = 1,
      metadata?: Record<string, string>,
    ): Promise<Stripe.PromotionCode | null> {
      const context = await getAuthContext();
      if (!context) {
        return null;
      }

      let stripeCustomerId = await getStripeCustomerId(
        context.userId,
        context.organizationId,
      );

      // Create Stripe customer if doesn't exist
      if (!stripeCustomerId) {
        const customer = context.organizationId
          ? await this.createStripeCustomerForOrganization(
              context.organizationId,
            )
          : await this.createStripeCustomerForUser(context.userId);

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

    async getCreditsForCoupon(couponId: string, price: Price): Promise<number> {
      const coupon = await stripeClient.getCouponById(couponId);
      if (!coupon) {
        throw new CouponNotFoundError(couponId);
      }
      if (coupon.percent_off) {
        throw new CouponTypeError("Only fixed-amount coupons are supported");
      }
      if (!coupon.amount_off) {
        throw new CouponTypeError("Coupon must have a fixed amount");
      }

      if (coupon.currency?.toLowerCase() !== price.currency.toLowerCase()) {
        throw new CouponCurrencyError(
          coupon.currency ?? "unknown",
          price.currency,
        );
      }

      // Prevent division by zero for price.unit_amount
      if (price.amountPerCredit === 0) {
        throw new CouponTypeError(
          "Price amountPerCredit is 0 – cannot calculate credits for free product",
        );
      }
      const credits = Math.floor(coupon.amount_off / price.amountPerCredit);
      if (credits < 1) {
        throw new CouponTypeError("Coupon amount is too low");
      }
      return credits;
    },

    async createStripeCustomerForUser(
      userId: string,
    ): Promise<Stripe.Customer | null> {
      const user = await userRepository.getUserById(userId);
      if (!user) {
        return null;
      }
      return await stripeClient.createUserCustomer(user);
    },

    async createStripeCustomerForOrganization(
      organizationId: string,
    ): Promise<Stripe.Customer | null> {
      const organization =
        await organizationRepository.getOrganizationWithRelationsById(
          organizationId,
        );
      if (!organization) {
        return null;
      }
      return await stripeClient.createOrganizationCustomer(organization);
    },

    async syncOrganizationInvoiceEmailWithStripe(
      organizationId: string,
      invoiceEmail: string | null,
    ): Promise<boolean> {
      try {
        const organization =
          await organizationRepository.getOrganizationWithRelationsById(
            organizationId,
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
        const user = await userRepository.getUserById(userId);

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
      const user = await userRepository.getUserById(userId);
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
          );
        if (organization && organization.stripeCustomerId) {
          orgCoupon = await this.getCoupon(
            getEnvSecrets().STRIPE_ONBOARD_ORGANIZATION_COUPON,
          );

          const orgInvoice = await stripeClient.applyInvoiceCreditsToCustomer(
            organization.stripeCustomerId,
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
        }
      }

      return { personalCoupon, orgCoupon };
    },

    /**
     * Claims a welcome coupon for a customer.
     * @param userId - The ID of the user.
     */
    async claimWelcomeCoupon(
      userId: string,
    ): Promise<{ couponApplied: boolean; invoiceId: string | null }> {
      const welcomeCouponId = getEnvSecrets().STRIPE_WELCOME_COUPON;
      try {
        const user = await userRepository.getUserById(userId);
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
            user_email: user.email,
          },
        );
        if (!invoice || !invoice?.id) {
          throw new Error("Failed to apply welcome coupon");
        }
        return { couponApplied: true, invoiceId: invoice?.id ?? null };
      } catch (error) {
        Sentry.captureException(error, {
          contexts: {
            error_classification: {
              severity: "error",
              domain: "stripe_welcome_coupon",
              category: "service_layer",
            },
            extra: {
              userId,
            },
          },
        });
        return { couponApplied: false, invoiceId: null };
      }
    },
  };
})();
