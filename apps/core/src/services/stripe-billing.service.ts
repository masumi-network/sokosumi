import {
  type CreditTopUpLookupKey,
  getOrganizationMetadata,
  STANDARD_CREDIT_TOPUP_TIERS,
} from "@sokosumi/utils";
import type Stripe from "stripe";

import { stripeClient } from "@/clients/stripe.client";
import { badRequest, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { resolveZeroMarginTopUpLookupKey } from "@/lib/zero-margin-top-up";
import type { CreditTopUpPricing } from "@/schemas/billing.schema";
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

interface PromotionCodeWithExpandedCoupon
  extends Omit<Stripe.PromotionCode, "promotion"> {
  promotion?: {
    coupon?: string | Stripe.Coupon;
  };
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

function getCheckoutSessionCustomerId(
  session: Stripe.Checkout.Session,
): string | null {
  const { customer } = session;

  if (!customer) {
    return null;
  }

  if (typeof customer === "string") {
    return customer;
  }

  return customer.id;
}

function getPromotionCodeCustomerId(
  promotionCode: Stripe.PromotionCode,
): string | null {
  const { customer } = promotionCode;

  if (!customer) {
    return null;
  }

  if (typeof customer === "string") {
    return customer;
  }

  return customer.id;
}

function getPromotionCodeCouponTtlDays(
  promotionCode: Stripe.PromotionCode,
): string | undefined {
  const coupon = (promotionCode as PromotionCodeWithExpandedCoupon).promotion
    ?.coupon;

  if (
    typeof coupon !== "object" ||
    coupon === null ||
    !("metadata" in coupon)
  ) {
    return undefined;
  }

  return coupon.metadata?.ttl_days;
}

async function isCheckoutSessionOwnedByUser(
  session: Stripe.Checkout.Session,
  userId: string,
): Promise<boolean> {
  if (session.metadata?.userId === userId) {
    return true;
  }

  const sessionCustomerId = getCheckoutSessionCustomerId(session);
  if (!sessionCustomerId) {
    return false;
  }

  const [user, memberOrganizations] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    }),
    prisma.organization.findMany({
      where: {
        members: {
          some: { userId },
        },
      },
      select: { stripeCustomerId: true },
    }),
  ]);

  if (user?.stripeCustomerId === sessionCustomerId) {
    return true;
  }

  return memberOrganizations.some(
    (organization) => organization.stripeCustomerId === sessionCustomerId,
  );
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

async function resolveZeroMarginLookupKeyForUser(
  userId: string,
): Promise<CreditTopUpLookupKey | undefined> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return resolveZeroMarginTopUpLookupKey(user?.email);
}

export const stripeBillingService = {
  async getSubscriptionCatalog(): Promise<SubscriptionCatalog> {
    return await getSubscriptionCatalog();
  },

  async getCreditTopUpPricing(userId: string): Promise<CreditTopUpPricing> {
    const zeroMarginLookupKey = await resolveZeroMarginLookupKeyForUser(userId);

    if (zeroMarginLookupKey) {
      const price = await stripeClient.getPriceByLookupKey(zeroMarginLookupKey);
      return {
        currency: price.currency,
        tiers: [{ minCredits: 1, amountPerCredit: price.amountPerCredit }],
        referenceAmountPerCredit: price.amountPerCredit,
        canPurchaseOnFreePlan: true,
      };
    }

    const pricedTiers = await Promise.all(
      STANDARD_CREDIT_TOPUP_TIERS.map(async (tier) => {
        const price = await stripeClient.getPriceByLookupKey(tier.lookupKey);
        return {
          minCredits: tier.minCredits,
          amountPerCredit: price.amountPerCredit,
          currency: price.currency,
        };
      }),
    );

    const [baseTier] = pricedTiers;
    if (!baseTier) {
      throw badRequest("No credit top-up tiers configured");
    }

    return {
      currency: baseTier.currency,
      tiers: pricedTiers.map(({ minCredits, amountPerCredit }) => ({
        minCredits,
        amountPerCredit,
      })),
      // Base (smallest-volume) tier is the most expensive per credit; it is the
      // reference against which higher-volume savings are displayed.
      referenceAmountPerCredit: baseTier.amountPerCredit,
      canPurchaseOnFreePlan: false,
    };
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
  }): Promise<{ url: string }> {
    const stripeCustomerId = await ensureStripeCustomerId(
      params.userId,
      params.organizationId,
    );
    // Pricing curve is resolved server-side from the authenticated user — the
    // client cannot supply a lookup-key override.
    const zeroMarginLookupKey = await resolveZeroMarginLookupKeyForUser(
      params.userId,
    );
    const price = await stripeClient.getCreditTopUpPriceByCredits(
      params.credits,
      zeroMarginLookupKey,
    );
    let couponTtlDays: string | undefined;

    if (params.promotionCodeId) {
      const promotionCode = await stripeClient.getPromotionCodeById(
        params.promotionCodeId,
      );
      if (!promotionCode) {
        throw badRequest("Invalid promotion code");
      }

      const promotionCodeCustomerId = getPromotionCodeCustomerId(promotionCode);
      if (promotionCodeCustomerId !== stripeCustomerId) {
        throw badRequest("Invalid promotion code");
      }

      couponTtlDays = getPromotionCodeCouponTtlDays(promotionCode);
    }

    const session = await stripeClient.createCreditCheckoutSession({
      stripeCustomerId,
      userId: params.userId,
      organizationId: params.organizationId,
      credits: params.credits,
      price,
      promotionCodeId: params.promotionCodeId,
      returnPath: params.returnPath,
      couponTtlDays,
    });

    if (!session.url) {
      throw badRequest("Failed to create checkout session");
    }

    return { url: session.url };
  },

  async getCheckoutSessionAnalytics(sessionId: string, userId: string) {
    const session = await stripeClient.getCheckoutSession(sessionId);
    const isOwnedByUser = await isCheckoutSessionOwnedByUser(session, userId);
    if (!isOwnedByUser) {
      throw notFound("Checkout session not found");
    }

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
