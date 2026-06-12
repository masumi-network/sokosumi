import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountListCreditPrices from "./credits/get.js";

/**
 * Product catalog reads (Stripe-backed). `/credits` lists the credit
 * product's prices; `/subscription` is the planned sibling for subscription
 * product information. Session-scoped — pricing is not sensitive and the
 * same reads back both the admin invoice form and future user-facing billing
 * surfaces.
 */
const app = new OpenAPIHonoWithAuth();

mountListCreditPrices(app);

export default app;
