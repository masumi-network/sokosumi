import { stripeClient } from "@/clients/stripe.client";
import { getEnv } from "@/config/env";

/**
 * Subscription credits granted per assigned seat for each self-serve paid
 * plan, resolved from Stripe product metadata (`credits`). Mirrors the
 * `credits` parsing of the web app's subscription catalog
 * (`apps/web/src/lib/stripe/subscription-catalog.ts`); core only needs the
 * per-plan credits for seat-assignment grants, not the full catalog.
 */
export interface SeatCreditsByPlan {
  pro: number;
  standard: number;
  starter: number;
}

type PaidPlanName = keyof SeatCreditsByPlan;

let seatCreditsCache: Promise<SeatCreditsByPlan> | null = null;

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

async function loadPlanCredits(
  planName: PaidPlanName,
  productId: string,
): Promise<number> {
  const product = await stripeClient.retrieveProduct(productId);

  return parseCredits(product.metadata.credits, planName);
}

async function loadSeatCreditsByPlan(): Promise<SeatCreditsByPlan> {
  const env = getEnv();

  const [pro, standard, starter] = await Promise.all([
    loadPlanCredits("pro", env.STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID),
    loadPlanCredits("standard", env.STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID),
    loadPlanCredits("starter", env.STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID),
  ]);

  return { pro, standard, starter };
}

export function invalidateSubscriptionSeatCreditsCache(): void {
  seatCreditsCache = null;
}

/**
 * Resolves the per-seat subscription credits for the paid self-serve plans
 * from Stripe, caching the result for the process lifetime (a failed load is
 * not cached and is retried on the next call).
 */
export async function getSubscriptionSeatCredits(): Promise<SeatCreditsByPlan> {
  if (!seatCreditsCache) {
    seatCreditsCache = loadSeatCreditsByPlan().catch((err) => {
      seatCreditsCache = null;
      throw err;
    });
  }
  return await seatCreditsCache;
}
