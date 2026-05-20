import "server-only";

import type { StripePlan } from "@better-auth/stripe";
import { FREE_SUBSCRIPTION_MONTHLY_CREDITS } from "@sokosumi/database/helpers";
import type Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";

export type SubscriptionPlanName =
  | "enterprise"
  | "free"
  | "pro"
  | "standard"
  | "starter";

/** Paid catalog plans (excludes `free`). Used for Stripe checkout upgrade flows. */
export type PaidSubscriptionPlanName = Exclude<SubscriptionPlanName, "free">;

type SelfServePaidSubscriptionPlanName = Exclude<
  PaidSubscriptionPlanName,
  "enterprise"
>;

export interface SubscriptionCatalogPlan {
  credits: number;
  currency: string;
  monthlyAmount: number;
  name: SubscriptionPlanName;
  priceId: string;
  productId: string;
  slug: string;
}

export interface SubscriptionCatalog {
  enterpriseProducts: SubscriptionCatalogPlan[];
  free: SubscriptionCatalogPlan;
  pro: SubscriptionCatalogPlan;
  standard: SubscriptionCatalogPlan;
  starter: SubscriptionCatalogPlan;
}

interface RawPlanConfig {
  name: SelfServePaidSubscriptionPlanName;
  productId: string;
}

type MonthlyStripePrice = Stripe.Price & { unit_amount: number };

const MAX_ENTERPRISE_PRODUCT_PAGES = 100;

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

export function isEnterpriseSlug(
  metadata: Stripe.Metadata | null | undefined,
): boolean {
  return metadata?.slug?.trim().toLowerCase() === "enterprise";
}

export function hydrateEnterprisePlan(
  product: Stripe.Product,
): SubscriptionCatalogPlan {
  const price = parsePrice(product.default_price, "enterprise");
  const slug = parseSlug(product.metadata.slug, "enterprise");
  const credits = parseCredits(product.metadata.credits, "enterprise");

  return {
    credits,
    currency: price.currency,
    monthlyAmount: price.unit_amount,
    name: "enterprise",
    priceId: price.id,
    productId: product.id,
    slug,
  };
}

export async function discoverEnterpriseProducts(
  stripe: Stripe,
): Promise<SubscriptionCatalogPlan[]> {
  const enterpriseProducts: SubscriptionCatalogPlan[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < MAX_ENTERPRISE_PRODUCT_PAGES; page += 1) {
    const products = await stripe.products.list({
      active: true,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    const enterpriseProductIds = products.data
      .filter((product) => isEnterpriseSlug(product.metadata))
      .map((product) => product.id);

    const hydratedProducts = await Promise.all(
      enterpriseProductIds.map(async (productId) => {
        const product = await stripe.products.retrieve(productId, {
          expand: ["default_price"],
        });
        return hydrateEnterprisePlan(product);
      }),
    );
    enterpriseProducts.push(...hydratedProducts);

    if (!products.has_more) {
      return enterpriseProducts;
    }

    const lastProduct = products.data.at(-1);
    if (!lastProduct) {
      return enterpriseProducts;
    }

    startingAfter = lastProduct.id;
  }

  throw new Error(
    `Exceeded ${MAX_ENTERPRISE_PRODUCT_PAGES} pages while discovering enterprise Stripe products`,
  );
}

export async function resolveEnterpriseProduct(
  stripe: Stripe,
  productId: string,
): Promise<SubscriptionCatalogPlan | null> {
  const product = await stripe.products.retrieve(productId, {
    expand: ["default_price"],
  });

  if (product.active === false || !isEnterpriseSlug(product.metadata)) {
    return null;
  }

  try {
    return hydrateEnterprisePlan(product);
  } catch {
    return null;
  }
}

async function loadCatalog(stripe: Stripe): Promise<SubscriptionCatalog> {
  const [paidEntries, enterpriseProducts] = await Promise.all([
    Promise.all(
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
    ),
    discoverEnterpriseProducts(stripe),
  ]);

  const paidCatalog = Object.fromEntries(paidEntries) as Omit<
    SubscriptionCatalog,
    "enterpriseProducts" | "free"
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
    enterpriseProducts,
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

export async function getBetterAuthSubscriptionPlans(
  stripe: Stripe,
): Promise<StripePlan[]> {
  const catalog = await getSubscriptionCatalog(stripe);
  const selfServePlans: SelfServePaidSubscriptionPlanName[] = [
    "starter",
    "standard",
    "pro",
  ];

  return [
    ...selfServePlans.flatMap((name) => {
      const plan = catalog[name];
      if (!plan) return [];

      return [
        {
          limits: {
            credits: plan.credits,
          },
          name,
          priceId: plan.priceId,
        },
      ];
    }),
    ...catalog.enterpriseProducts.map((plan) => ({
      limits: {
        credits: plan.credits,
      },
      name: "enterprise",
      priceId: plan.priceId,
    })),
  ];
}
