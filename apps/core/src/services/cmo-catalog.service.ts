import * as Sentry from "@sentry/node";
import { z } from "zod";

import { listPolarProducts, type PolarProduct } from "@/clients/polar.client";

/** What CMO sells through Polar (ADR 0068), read from the Polar products. */

export interface CmoPlan {
  /** The monthly grant, on yearly plans too. */
  credits: number;
  currency: string;
  interval: "month" | "year";
  name: string;
  /** Price per interval in the currency's minor unit. */
  priceAmount: number;
  productId: string;
  tier: string;
}

export interface CmoTopUpPack {
  credits: number;
  currency: string;
  name: string;
  /** Price in the currency's minor unit. */
  priceAmount: number;
  productId: string;
}

export interface CmoCatalog {
  /** Monthly plans before yearly, each by credits. */
  plans: CmoPlan[];
  /** By credits. */
  topUps: CmoTopUpPack[];
}

// Polar metadata values are strings, numbers or booleans; the dashboard
// stores what is typed there as a string.
const creditsSchema = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().positive());

const metadataSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("plan"),
    tier: z.string().trim().min(1),
    credits: creditsSchema,
  }),
  z.object({ kind: z.literal("top-up"), credits: creditsSchema }),
]);

let catalogCache: Promise<CmoCatalog> | null = null;

function fixedPrice(product: PolarProduct) {
  for (const price of product.prices) {
    if ("amount_type" in price && price.amount_type === "fixed") {
      if (!price.is_archived) return price;
    }
  }
  return null;
}

/** Adds the product to the catalog, or returns why it does not belong. */
function addProduct(catalog: CmoCatalog, product: PolarProduct): string | null {
  const metadata = metadataSchema.safeParse(product.metadata);
  if (!metadata.success) return z.prettifyError(metadata.error);
  const price = fixedPrice(product);
  if (!price) return "no fixed price";
  const entry = {
    credits: metadata.data.credits,
    currency: price.price_currency,
    name: product.name,
    priceAmount: price.price_amount,
    productId: product.id,
  };

  if (metadata.data.kind === "top-up") {
    if (product.is_recurring) return "a top-up pack must not recur";
    catalog.topUps.push(entry);
    return null;
  }
  const interval = product.recurring_interval;
  if (
    (interval !== "month" && interval !== "year") ||
    product.recurring_interval_count !== 1
  ) {
    return "a plan must recur every month or every year";
  }
  catalog.plans.push({ ...entry, interval, tier: metadata.data.tier });
  return null;
}

async function loadCatalog(): Promise<CmoCatalog> {
  const catalog: CmoCatalog = { plans: [], topUps: [] };
  for (const product of await listPolarProducts()) {
    const issue = addProduct(catalog, product);
    if (issue) {
      Sentry.captureMessage("Polar product ignored by the CMO catalog", {
        level: "warning",
        tags: { error_type: "invalid_polar_product" },
        extra: { productId: product.id, productName: product.name, issue },
      });
    }
  }
  catalog.plans.sort(
    (a, b) =>
      a.interval.localeCompare(b.interval) ||
      a.credits - b.credits ||
      a.productId.localeCompare(b.productId),
  );
  catalog.topUps.sort((a, b) => a.credits - b.credits);
  return catalog;
}

/**
 * The CMO plans and Project top-up packs, cached for the process lifetime as
 * the Stripe subscription catalog is (a failed load is not cached and is
 * retried on the next call).
 */
export async function getCmoCatalog(): Promise<CmoCatalog> {
  if (!catalogCache) {
    catalogCache = loadCatalog().catch((error) => {
      catalogCache = null;
      throw error;
    });
  }
  return await catalogCache;
}
