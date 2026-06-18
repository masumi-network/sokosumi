import type { CreditTopUpLookupKey } from "@sokosumi/utils";
import { getOrganizationMetadata } from "@sokosumi/utils";
import type Stripe from "stripe";

import { type CreditPrice, stripeClient } from "@/clients/stripe.client";
import { badRequest, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { SubscriptionCatalog } from "@/services/subscription-catalog.service";
import { getSubscriptionCatalog } from "@/services/subscription-catalog.service";

export class CouponNotFoundError extends Error {
  constructor(couponId: string) {
    super(`Coupon not found: ${couponId}`);
    this.name = "CouponNotFoundError";
  }
}

export class CouponTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CouponTypeError";
  }
}

function getCreditsForCoupon(coupon: Stripe.Coupon): number {
  if (!coupon.percent_off) {
    throw new CouponTypeError("Coupon must have percent_off");
  }

  const creditsRaw = coupon.metadata?.credits;
  if (!creditsRaw) {
    throw new CouponTypeError(
      "Coupon metadata must include credits as a positive integer",
    );
  }

  const credits = Number(creditsRaw);
  if (!Number.isFinite(credits) || !Number.isInteger(credits) || credits <= 0) {
    throw new CouponTypeError(
      "Coupon metadata credits must be a positive integer",
    );
  }
  return credits;
}

function mapCheckoutSessionAnalytics(session: Stripe.Checkout.Session): {
  sessionId: string;
  currency: string | null;
  value: number | null;
  items: Array<{
    itemId: string;
    itemName: string;
    quantity: number | null;
  }>;
} {
  const lineItems = session.line_items?.data ?? [];
  const items = lineItems.flatMap((item) => {
    const product = item.price?.product;
    if (
      product &&
      typeof product === "object" &&
      "id" in product &&
      "name" in product &&
      typeof product.id === "string" &&
      typeof product.name === "string"
    ) {
      return [
        {
          itemId: product.id,
          itemName: product.name,
          quantity: item.quantity,
        },
      ];
    }

    return [];
  });

  return {
    sessionId: session.id,
    currency: session.currency,
    value: session.amount_total,
    items,
  };
}

async function ensureStripeCustomerId(
  userId: string,
  organizationId: string | null,
): Promise<string> {
  if (organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        stripeCustomerId: true,
        metadata: true,
      },
    });

    if (!organization) {
      throw notFound("Organization not found");
    }

    if (organization.stripeCustomerId) {
      return organization.stripeCustomerId;
    }

    const customer = await stripeClient.createOrganizationCustomer({
      organizationId: organization.id,
      slug: organization.slug,
      name: organization.name,
      invoiceEmail: getOrganizationMetadata(organization.metadata).invoiceEmail,
    });

    return customer.id;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, stripeCustomerId: true },
  });

  if (!user) {
    throw notFound("User not found");
  }

  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await stripeClient.createUserCustomer({
    email: user.email,
    name: user.name,
    userId: user.id,
  });

  return customer.id;
}

export const stripeBillingService = {
  async getSubscriptionCatalog(): Promise<SubscriptionCatalog> {
    return await getSubscriptionCatalog();
  },

  async getCreditTopUpPriceCatalog(
    extraLookupKeys: CreditTopUpLookupKey[] = [],
  ): Promise<Record<CreditTopUpLookupKey, CreditPrice>> {
    return await stripeClient.getCreditTopUpPriceCatalog(extraLookupKeys);
  },

  async getCouponDetails(couponId: string): Promise<{
    id: string;
    percentOff: number;
    credits: number;
    ttlDays: string | null;
  }> {
    const coupon = await stripeClient.getCouponById(couponId);
    if (!coupon) {
      throw new CouponNotFoundError(couponId);
    }

    return {
      id: coupon.id,
      percentOff: coupon.percent_off ?? 0,
      credits: getCreditsForCoupon(coupon),
      ttlDays: coupon.metadata?.ttl_days ?? null,
    };
  },

  async claimCoupon(params: {
    userId: string;
    organizationId: string | null;
    couponId: string;
    maxRedemptions?: number;
    metadata?: Record<string, string>;
  }): Promise<{ promotionCodeId: string; active: boolean }> {
    const stripeCustomerId = await ensureStripeCustomerId(
      params.userId,
      params.organizationId,
    );

    const existingPromotionCode = await stripeClient.getPromotionCode(
      stripeCustomerId,
      params.couponId,
    );
    if (existingPromotionCode) {
      return {
        promotionCodeId: existingPromotionCode.id,
        active: existingPromotionCode.active,
      };
    }

    try {
      const promotionCode = await stripeClient.createPromotionCode(
        stripeCustomerId,
        params.couponId,
        params.maxRedemptions ?? 1,
        params.metadata,
      );

      if (!promotionCode) {
        throw badRequest("Failed to claim coupon");
      }

      return {
        promotionCodeId: promotionCode.id,
        active: promotionCode.active,
      };
    } catch (error) {
      console.error("Error claiming coupon:", error);
      const fallbackPromotionCode = await stripeClient.getPromotionCode(
        stripeCustomerId,
        params.couponId,
      );
      if (!fallbackPromotionCode) {
        throw badRequest("Failed to claim coupon");
      }

      return {
        promotionCodeId: fallbackPromotionCode.id,
        active: fallbackPromotionCode.active,
      };
    }
  },

  async createCreditCheckoutSession(params: {
    userId: string;
    organizationId: string | null;
    credits: number;
    returnPath?: string;
    promotionCodeId?: string | null;
    priceLookupKeyOverride?: CreditTopUpLookupKey;
    origin?: string | null;
    ttlDays?: string;
  }): Promise<{ url: string }> {
    const stripeCustomerId = await ensureStripeCustomerId(
      params.userId,
      params.organizationId,
    );
    const price = params.priceLookupKeyOverride
      ? await stripeClient.getPriceByLookupKey(params.priceLookupKeyOverride)
      : await stripeClient.getCreditTopUpPriceByCredits(params.credits);

    const session = await stripeClient.createCreditCheckoutSession({
      stripeCustomerId,
      userId: params.userId,
      organizationId: params.organizationId,
      credits: params.credits,
      price,
      origin: params.origin,
      promotionCodeId: params.promotionCodeId,
      returnPath: params.returnPath,
      ttlDays: params.ttlDays,
    });

    if (!session.url) {
      throw badRequest("Failed to create checkout session");
    }

    return { url: session.url };
  },

  async getCheckoutSessionAnalytics(sessionId: string) {
    const session = await stripeClient.getCheckoutSession(sessionId);
    return mapCheckoutSessionAnalytics(session);
  },

  async syncOrganizationInvoiceEmailWithStripe(
    organizationId: string,
    invoiceEmail: string | null,
  ): Promise<void> {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { stripeCustomerId: true },
    });

    if (!organization?.stripeCustomerId) {
      return;
    }

    await stripeClient.updateCustomerEmail(
      organization.stripeCustomerId,
      invoiceEmail,
    );
  },
};
