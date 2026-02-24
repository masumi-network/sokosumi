import type { Hono } from "hono";

import { stripeCustomerSyncService } from "@/services/stripe-customer-sync.service";

import { handleSyncRequest } from "../handler.js";

export const STRIPE_CUSTOMERS_SYNC_LOCK_KEY = "stripe-customers-sync";

export default function mount(app: Hono) {
  app.get("/stripe-customers", async (c) => {
    return await handleSyncRequest(
      c,
      STRIPE_CUSTOMERS_SYNC_LOCK_KEY,
      async () => {
        await stripeCustomerSyncService.syncAllStripeCustomers();
      },
    );
  });
}
