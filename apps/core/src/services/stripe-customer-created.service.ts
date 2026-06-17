import { ensureInitialLocalFreeSubscriptionPeriod } from "@sokosumi/database/helpers";
import { userRepository } from "@sokosumi/database/repositories";
import type Stripe from "stripe";

import { stripeClient } from "@/clients/stripe.client";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

/**
 * Port of the web app's welcome-coupon claim
 * (`apps/web/src/lib/services/stripe.service.ts`). The idempotency key base
 * (`welcome-{couponId}-{userId}`) MUST stay identical to the web flow so a
 * `customer.created` redelivery replays the original grant instead of
 * issuing a second invoice. Never throws — a failed claim is logged and
 * reported as `couponApplied: false` so customer creation is not retried
 * just because the coupon flow hiccupped.
 */
export async function claimWelcomeCoupon(
  userId: string,
): Promise<{ couponApplied: boolean; invoiceId: string | null }> {
  const welcomeCouponId = getEnv().STRIPE_WELCOME_COUPON;

  try {
    const user = await userRepository.getUserById(userId, prisma);
    if (!user) {
      throw new Error("User not found");
    }
    if (!user.stripeCustomerId) {
      throw new Error("User does not have a stripe customer id");
    }

    const coupon = await stripeClient.getCouponById(welcomeCouponId);
    if (!coupon) {
      throw new Error(`Coupon not found: ${welcomeCouponId}`);
    }

    // Stable per user+coupon: a `customer.created` webhook redelivery
    // replays the original grant instead of issuing a second invoice.
    const invoice = await stripeClient.applyInvoiceCreditsToCustomer(
      user.stripeCustomerId,
      coupon.id,
      `welcome-${coupon.id}-${user.id}`,
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
    console.error(`Failed to claim welcome coupon for user ${userId}:`, error);
    return { couponApplied: false, invoiceId: null };
  }
}

/**
 * Port of the web app's `handleCustomerCreatedEvent`
 * (Core `stripe-backed-subscription.service.ts`): writes the Stripe
 * customer id back to the user/organization, seeds the initial local free
 * subscription period, and claims the welcome coupon for user customers.
 */
export async function handleCustomerCreatedEvent(
  customer: Stripe.Customer,
): Promise<void> {
  const metadata = customer.metadata;
  switch (metadata?.customerType) {
    case "user": {
      const userId = metadata.userId;
      const user = await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customer.id },
      });
      console.log(`✅ Set user ${userId} stripe customer id to ${customer.id}`);

      await prisma.$transaction(async (tx) => {
        await ensureInitialLocalFreeSubscriptionPeriod(
          {
            createdAt: user.createdAt,
            kind: "user",
            stripeCustomerId: customer.id,
            userId,
          },
          tx,
        );
      });

      const { couponApplied, invoiceId } = await claimWelcomeCoupon(userId);
      if (couponApplied && invoiceId) {
        console.log(
          `✅ Claimed welcome coupon for user ${userId}, invoice: ${invoiceId}`,
        );
      } else {
        console.log(`⚠️ Failed to claim welcome coupon for user ${userId}`);
      }
      break;
    }
    case "organization": {
      const organization = await prisma.organization.update({
        where: { id: metadata.organizationId },
        data: { stripeCustomerId: customer.id },
      });
      console.log(
        `✅ Set organization ${metadata.organizationId} stripe customer id to ${customer.id}`,
      );

      await prisma.$transaction(async (tx) => {
        await ensureInitialLocalFreeSubscriptionPeriod(
          {
            createdAt: organization.createdAt,
            kind: "organization",
            organizationId: metadata.organizationId,
            stripeCustomerId: customer.id,
          },
          tx,
        );
      });
      break;
    }
    default: {
      console.log(`Unknown customer type ${metadata?.customerType}`);
      break;
    }
  }
}
