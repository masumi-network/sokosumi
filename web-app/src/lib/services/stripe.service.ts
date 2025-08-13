import "server-only";

import { headers } from "next/headers";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { UnAuthenticatedError } from "@/lib/auth/errors";
import { verifyUserId } from "@/lib/auth/utils";
import { Price, stripeClient } from "@/lib/clients/stripe.client";
import { convertCreditsToCents } from "@/lib/db";
import {
  fiatTransactionRepository,
  organizationRepository,
  prisma,
  userRepository,
} from "@/lib/db/repositories";
import {
  CouponCurrencyError,
  CouponNotFoundError,
  CouponTypeError,
  PromotionCodeNotFoundError,
} from "@/lib/errors/coupon-errors";

export const stripeService = (() => {
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
        const user = await userRepository.getUserById(userId);
        if (!user) throw new Error("User not found");

        // Get or create the appropriate Stripe customer ID (has its own transaction)
        let stripeCustomerId: string | null;
        if (organizationId) {
          // Use organization's Stripe customer
          stripeCustomerId =
            await this.getOrCreateStripeCustomerForOrganization(organizationId);
          if (!stripeCustomerId) {
            throw new Error(
              "Failed to get or create organization Stripe customer",
            );
          }
        } else {
          // Use user's Stripe customer
          stripeCustomerId =
            await this.getOrCreateStripeCustomerForUser(userId);
          if (!stripeCustomerId) {
            throw new Error("Failed to get or create user Stripe customer");
          }
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

    async getWelcomePromotionCode(
      userId: string,
    ): Promise<Stripe.PromotionCode | null> {
      const couponIds = getEnvSecrets().STRIPE_WELCOME_COUPONS;
      if (couponIds.length === 0) {
        return null;
      }

      const isVerified = await verifyUserId(userId);
      if (!isVerified) {
        return null;
      }

      const user = await userRepository.getUserById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      const stripeCustomerId =
        await this.getOrCreateStripeCustomerForUser(userId);
      if (!stripeCustomerId) {
        return null;
      }

      for (const couponId of couponIds) {
        try {
          const promotionCode = await stripeClient.getPromotionCode(
            stripeCustomerId,
            couponId,
          );
          if (
            promotionCode?.times_redeemed &&
            promotionCode.times_redeemed >= 1
          ) {
            return null;
          }
        } catch {
          return null;
        }
      }

      const lastCouponId = couponIds.at(-1);
      if (!lastCouponId) {
        return null;
      }

      return await this.getPromotionCode(userId, lastCouponId, 1);
    },

    async getPromotionCode(
      userId: string,
      couponId: string,
      maxRedemptions: number = 1,
      metadata?: Record<string, string>,
    ): Promise<Stripe.PromotionCode | null> {
      const isVerified = await verifyUserId(userId);
      if (!isVerified) {
        return null;
      }
      const user = await userRepository.getUserById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      try {
        // Use the new atomic customer creation method
        const stripeCustomerId =
          await this.getOrCreateStripeCustomerForUser(userId);
        if (!stripeCustomerId) {
          return null;
        }

        // Check for existing promotion codes
        let promotionCode = await stripeClient.getPromotionCode(
          stripeCustomerId,
          couponId,
        );
        if (promotionCode) {
          return promotionCode;
        }

        // Create new promotion code
        promotionCode = await stripeClient.createPromotionCode(
          stripeCustomerId,
          couponId,
          maxRedemptions,
          metadata,
        );

        return promotionCode;
      } catch (error) {
        console.error(
          `Error in getOrCreatePromotionCode for user ${userId}:`,
          error,
        );
        return null;
      }
    },

    async getCreditsForPromotionCode(
      promotionCode: string,
      price: Price,
    ): Promise<number> {
      const coupon = await stripeClient.getCouponByPromotionCode(promotionCode);
      if (!coupon) {
        throw new PromotionCodeNotFoundError(promotionCode);
      }
      return this.getCreditsForCoupon(coupon.id, price);
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

    async getOrCreateStripeCustomerForUser(
      userId: string,
    ): Promise<string | null> {
      return await prisma.$transaction(async (tx) => {
        try {
          const user = await userRepository.getUserById(userId, tx);

          if (!user) {
            return null;
          }

          // If user already has a Stripe customer ID, return it
          if (user.stripeCustomerId) {
            return user.stripeCustomerId;
          }

          // Create a new Stripe customer for the user
          const customer = await stripeClient.createUserCustomer(user);

          try {
            // Save the customer ID to the database
            const updatedUser = await userRepository.setUserStripeCustomerId(
              user.id,
              customer.id,
              tx,
            );
            return updatedUser.stripeCustomerId;
          } catch (_error) {
            // If there's a unique constraint violation, clean up the Stripe customer
            // and return the existing customer ID from the database
            try {
              await stripeClient.deleteCustomer(customer.id);
            } catch (cleanupError) {
              console.warn(
                `Failed to cleanup duplicate Stripe customer ${customer.id}:`,
                cleanupError,
              );
            }

            // Fetch the updated user record to get the existing customer ID
            const updatedUser = await userRepository.getUserById(userId, tx);
            return updatedUser?.stripeCustomerId ?? null;
          }
        } catch (error) {
          console.error(
            `Error in getOrCreateStripeCustomerForUser for user ${userId}:`,
            error,
          );
          return null;
        }
      });
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

    async getOrCreateStripeCustomerForOrganization(
      organizationId: string,
    ): Promise<string | null> {
      return await prisma.$transaction(async (tx) => {
        try {
          const organization =
            await organizationRepository.getOrganizationWithRelationsById(
              organizationId,
              tx,
            );

          if (!organization) {
            return null;
          }

          // If organization already has a Stripe customer ID, return it
          if (organization.stripeCustomerId) {
            return organization.stripeCustomerId;
          }

          // Create a new Stripe customer for the organization
          const customer =
            await stripeClient.createOrganizationCustomer(organization);

          try {
            // Save the customer ID to the database
            const updatedOrg =
              await organizationRepository.setOrganizationStripeCustomerId(
                organization.id,
                customer.id,
                tx,
              );
            return updatedOrg.stripeCustomerId;
          } catch (_error) {
            // If there's a unique constraint violation, clean up the Stripe customer
            // and return the existing customer ID from the database
            try {
              await stripeClient.deleteCustomer(customer.id);
            } catch (cleanupError) {
              console.warn(
                `Failed to cleanup duplicate Stripe customer ${customer.id}:`,
                cleanupError,
              );
            }

            // Fetch the updated organization record to get the existing customer ID
            const updatedOrganization =
              await organizationRepository.getOrganizationWithRelationsById(
                organizationId,
                tx,
              );
            return updatedOrganization?.stripeCustomerId ?? null;
          }
        } catch (error) {
          console.error(
            `Error in getOrCreateStripeCustomerForOrganization for organization ${organizationId}:`,
            error,
          );
          return null;
        }
      });
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
  };
})();
