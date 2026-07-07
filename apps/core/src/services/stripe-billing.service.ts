import { resolveOrganizationBillingPlan } from "@sokosumi/database/helpers";
import { subscriptionRepository } from "@sokosumi/database/repositories";
import {
  type CreditTopUpLookupKey,
  STANDARD_CREDIT_TOPUP_TIERS,
} from "@sokosumi/utils";
import type Stripe from "stripe";

import { stripeClient } from "@/clients/stripe.client";
import { badRequest, forbidden, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { resolveZeroMarginTopUpLookupKey } from "@/lib/zero-margin-top-up";
import type { CreditTopUpPricing } from "@/schemas/billing.schema";
import {
  provisionOrganizationStripeCustomer,
  provisionUserStripeCustomer,
} from "@/services/stripe-customer-provision.service";
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

/**
 * Parses the credit grant encoded on a coupon for the client-facing
 * checkout/claim flows, throwing typed `CouponTypeError`s that the routes map
 * to 400/404. A sibling `getCreditsForCoupon` in `stripe.client.ts` throws
 * plain `Error`s for the internal webhook-replay invoice path — keep the two
 * validation rules in sync.
 */
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

function getPromotionCodeCoupon(
  promotionCode: Stripe.PromotionCode,
): Stripe.Coupon | null {
  const coupon = (promotionCode as PromotionCodeWithExpandedCoupon).promotion
    ?.coupon;

  if (typeof coupon !== "object" || coupon === null) {
    return null;
  }

  return coupon;
}

function getPromotionCodeCouponTtlDays(
  promotionCode: Stripe.PromotionCode,
): string | undefined {
  return getPromotionCodeCoupon(promotionCode)?.metadata?.ttl_days;
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
      },
    });

    if (!organization) {
      throw notFound("Organization not found");
    }

    if (organization.stripeCustomerId) {
      return organization.stripeCustomerId;
    }

    return await provisionOrganizationStripeCustomer({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    });
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

  return await provisionUserStripeCustomer({
    id: user.id,
    name: user.name,
    email: user.email,
  });
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

/**
 * Whether the billing account behind a credit purchase is on the free plan.
 * Org-scoped purchases resolve the organization's billing plan; personal
 * purchases resolve the user's active personal subscription (none == free).
 */
async function isAccountOnFreePlan(
  userId: string,
  organizationId: string | null,
): Promise<boolean> {
  if (organizationId) {
    const billingPlan = await resolveOrganizationBillingPlan(
      organizationId,
      prisma,
    );
    return billingPlan.plan === "free";
  }

  const subscription =
    await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      userId,
      prisma,
    );
  return (subscription?.plan ?? "free") === "free";
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

    const pricesByKey = await stripeClient.getPricesByLookupKeys(
      STANDARD_CREDIT_TOPUP_TIERS.map((tier) => tier.lookupKey),
    );
    const pricedTiers = STANDARD_CREDIT_TOPUP_TIERS.map((tier) => {
      const price = pricesByKey.get(tier.lookupKey);
      if (!price) {
        throw badRequest(`Missing credit price for tier ${tier.lookupKey}`);
      }
      return {
        minCredits: tier.minCredits,
        amountPerCredit: price.amountPerCredit,
        currency: price.currency,
      };
    });

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
    // Only credit-grant coupons (percent_off + credits metadata) may be
    // claimed. Validate before minting a customer-scoped promotion code so a
    // direct API caller cannot claim an arbitrary or non-credit coupon.
    const coupon = await stripeClient.getCouponById(params.couponId);
    if (!coupon) {
      throw new CouponNotFoundError(params.couponId);
    }
    getCreditsForCoupon(coupon);

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
      // createPromotionCode is idempotent (`${customerId}-${couponId}`), so a
      // failure here is most likely a code created by a concurrent request
      // between the check above and this create. Re-fetch and reuse it; if
      // there is still none, the create genuinely failed — surface the
      // original error rather than masking it with a generic message.
      console.error("Error claiming coupon:", error);
      const fallbackPromotionCode = await stripeClient.getPromotionCode(
        stripeCustomerId,
        params.couponId,
      );
      if (!fallbackPromotionCode) {
        throw error;
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

    // Paid credit purchases require an active (non-free) plan. Zero-margin
    // accounts are the only group allowed to buy on the free plan, mirroring
    // the catalog's `canPurchaseOnFreePlan`. Enforced here (not just in the web
    // UI) so Core remains the sole authority. Coupon redemptions
    // (`promotionCodeId` present) are exempt — they grant coupon-defined credits
    // and are allowed on any plan.
    if (
      !params.promotionCodeId &&
      !zeroMarginLookupKey &&
      (await isAccountOnFreePlan(params.userId, params.organizationId))
    ) {
      throw forbidden("Credit purchases require an active subscription");
    }

    // Credits default to the client-requested amount, but a coupon checkout
    // MUST grant exactly the coupon's credits. The discount is fully
    // server-applied, so without this a caller could pair a 100%-off promotion
    // code with an inflated `credits` value and mint free credits. When a
    // promotion code is supplied we re-derive credits from its coupon and
    // ignore the client value.
    let effectiveCredits = params.credits;
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

      const coupon = getPromotionCodeCoupon(promotionCode);
      if (!coupon) {
        throw badRequest("Invalid promotion code");
      }

      try {
        effectiveCredits = getCreditsForCoupon(coupon);
      } catch (error) {
        if (error instanceof CouponTypeError) {
          throw badRequest("Invalid promotion code");
        }
        throw error;
      }

      couponTtlDays = getPromotionCodeCouponTtlDays(promotionCode);
    }

    const price = await stripeClient.getCreditTopUpPriceByCredits(
      effectiveCredits,
      zeroMarginLookupKey,
    );

    const session = await stripeClient.createCreditCheckoutSession({
      stripeCustomerId,
      userId: params.userId,
      organizationId: params.organizationId,
      credits: effectiveCredits,
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
};
