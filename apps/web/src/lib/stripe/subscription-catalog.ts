import "server-only";

import {
  FREE_SUBSCRIPTION_MONTHLY_CREDITS,
  type PaidSubscriptionPlanName,
  type SelfServeSubscriptionPlanName,
} from "@sokosumi/utils";
import type Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";

export interface SubscriptionCatalogPlan {
  credits: number;
  currency: string;
  monthlyAmount: number;
  name: SelfServeSubscriptionPlanName;
  priceId: string;
  productId: string;
  slug: string;
}

export interface SubscriptionCatalog {
  free: SubscriptionCatalogPlan;
  pro: SubscriptionCatalogPlan;
  standard: SubscriptionCatalogPlan;
  starter: SubscriptionCatalogPlan;
}

interface RawPlanConfig {
  name: PaidSubscriptionPlanName;
  productId: string;
}

type MonthlyStripePrice = Stripe.Price & { unit_amount: number };

let catalogCache: Promise<SubscriptionCatalog> | null = null;

function getPaidPlanConfig(): RawPlanConfig[] {
  const env = getEnvSecrets();

  return [
    {
      name: "starter",
      productId: env.STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID,
    },
    {
      name: "standard",
      productId: env.STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID,
    },
    {
      name: "pro",
      productId: env.STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID,
    },
  ];
}

function parseCredits(rawValue: string | undefined, planName: string): number {
  if (!rawValue) {
    throw new Error(`Missing credits metadata for ${planName} plan`);
  }

  const credits = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(credits) || credits <= 0) {
    throw new Error(`Invalid credits metadata for ${planName} plan`);
  }
  return credits;
}

function parseSlug(rawValue: string | undefined, planName: string): string {
  if (!rawValue) {
    throw new Error(`Missing slug metadata for ${planName} plan`);
  }

  const slug = rawValue.trim().toLowerCase();
  if (slug !== planName) {
    throw new Error(`Unexpected slug metadata for ${planName} plan: ${slug}`);
  }
  return slug;
}

function parsePrice(
  defaultPrice: Stripe.Price | string | null | undefined,
  planName: PaidSubscriptionPlanName,
): MonthlyStripePrice {
  if (!defaultPrice || typeof defaultPrice === "string") {
    throw new Error(`Default price is not expanded for ${planName} plan`);
  }

  if (defaultPrice.type !== "recurring" || !defaultPrice.recurring) {
    throw new Error(`${planName} plan must have recurring pricing`);
  }

  if (
    defaultPrice.recurring.interval !== "month" ||
    defaultPrice.recurring.interval_count !== 1
  ) {
    throw new Error(`${planName} plan must have monthly recurring pricing`);
  }

  if (defaultPrice.unit_amount === null || defaultPrice.unit_amount < 0) {
    throw new Error(`Invalid unit amount for ${planName} plan`);
  }

  return defaultPrice as MonthlyStripePrice;
}

async function loadCatalog(stripe: Stripe): Promise<SubscriptionCatalog> {
  const paidEntries = await Promise.all(
    getPaidPlanConfig().map(async (rawPlan) => {
      const product = await stripe.products.retrieve(rawPlan.productId, {
        expand: ["default_price"],
      });

      const price = parsePrice(product.default_price, rawPlan.name);
      const slug = parseSlug(product.metadata.slug, rawPlan.name);
      const credits = parseCredits(product.metadata.credits, rawPlan.name);

      return [
        rawPlan.name,
        {
          credits,
          currency: price.currency,
          monthlyAmount: price.unit_amount,
          name: rawPlan.name,
          priceId: price.id,
          productId: rawPlan.productId,
          slug,
        },
      ] as const;
    }),
  );

  const paidCatalog = Object.fromEntries(paidEntries) as Omit<
    SubscriptionCatalog,
    "free"
  >;

  const freePlan: SubscriptionCatalogPlan = {
    credits: FREE_SUBSCRIPTION_MONTHLY_CREDITS,
    currency: paidCatalog.starter.currency,
    monthlyAmount: 0,
    name: "free",
    priceId: "",
    productId: "local-free",
    slug: "free",
  };

  return {
    free: freePlan,
    ...paidCatalog,
  };
}

export function invalidateSubscriptionCatalogCache(): void {
  catalogCache = null;
}

export async function getSubscriptionCatalog(
  stripe: Stripe,
): Promise<SubscriptionCatalog> {
  if (!catalogCache) {
    catalogCache = loadCatalog(stripe).catch((err) => {
      catalogCache = null;
      throw err;
    });
  }
  return await catalogCache;
}
