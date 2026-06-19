import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetCreditTopUpPriceCatalog from "./credits/catalog/get.js";
import mountListCreditPrices from "./credits/get.js";
import mountGetSubscriptionCatalog from "./subscription/get.js";

/**
 * Product catalog reads (Stripe-backed). `/credits` lists the credit
 * product's prices; `/credits/catalog` returns tiered lookup-key pricing;
 * `/subscription` exposes self-serve subscription plans.
 */
const app = new OpenAPIHonoWithAuth();

mountListCreditPrices(app);
mountGetCreditTopUpPriceCatalog(app);
mountGetSubscriptionCatalog(app);

export default app;
