import type { PaidSubscriptionPlanName } from "@sokosumi/utils";
import type Stripe from "stripe";

interface CachedPlanCredits {
  credits: number | null;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const planCreditsCache = new Map<PaidSubscriptionPlanName, CachedPlanCredits>();

function readProductId(plan: PaidSubscriptionPlanName): string | null {
  const envKey = {
    starter: "STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID",
    standard: "STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID",
    pro: "STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID",
  }[plan];

  const value = process.env[envKey]?.trim();
  return value ? value : null;
}

export async function getSubscriptionCatalogCreditsForPlan(
  stripe: Stripe,
  plan: PaidSubscriptionPlanName,
): Promise<number | null> {
  const cached = planCreditsCache.get(plan);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.credits;
  }

  const productId = readProductId(plan);
  if (!productId) {
    planCreditsCache.set(plan, { credits: null, fetchedAt: Date.now() });
    return null;
  }

  try {
    const product = await stripe.products.retrieve(productId);
    const rawCredits = product.metadata.credits;
    const credits = rawCredits ? Number.parseInt(rawCredits, 10) : NaN;
    const resolvedCredits =
      Number.isFinite(credits) && credits > 0 ? credits : null;

    planCreditsCache.set(plan, {
      credits: resolvedCredits,
      fetchedAt: Date.now(),
    });

    return resolvedCredits;
  } catch {
    planCreditsCache.set(plan, { credits: null, fetchedAt: Date.now() });
    return null;
  }
}
