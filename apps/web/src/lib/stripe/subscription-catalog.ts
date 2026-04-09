import "server-only";

import type { StripePlan } from "@better-auth/stripe";
import type Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";

export type SubscriptionPlanName = "free" | "starter" | "standard" | "pro";

export type PaidSubscriptionPlanName = Exclude<SubscriptionPlanName, "free">;

interface SubscriptionCatalogPlan {
  credits: number;
  currency: string;
  monthlyAmount: number;
  name: SubscriptionPlanName;
  priceId: string;
  productId: string;
  slug: string;
}

type SubscriptionCatalog = Record<
  SubscriptionPlanName,
  SubscriptionCatalogPlan
>;

interface RawPlanConfig {
  name: SubscriptionPlanName;
  productId: string;
}

let catalogCache: Promise<SubscriptionCatalog> | null = null;

function getPlanConfig(): RawPlanConfig[] {
  const env = getEnvSecrets();

  return [
    {
      name: "free",
      productId: env.STRIPE_FREE_SUBSCRIPTION_PRODUCT_ID,
    },
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
  planName: string,
): Stripe.Price {
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

  return defaultPrice;
}

async function loadCatalog(stripe: Stripe): Promise<SubscriptionCatalog> {
  const plans = await Promise.all(
    getPlanConfig().map(async (rawPlan) => {
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

  return Object.fromEntries(plans) as SubscriptionCatalog;
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

export async function getBetterAuthSubscriptionPlans(
  stripe: Stripe,
): Promise<StripePlan[]> {
  const catalog = await getSubscriptionCatalog(stripe);

  return (Object.keys(catalog) as SubscriptionPlanName[]).map((name) => ({
    limits: {
      credits: catalog[name].credits,
    },
    name,
    priceId: catalog[name].priceId,
  }));
}
