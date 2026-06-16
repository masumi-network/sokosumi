import type { Hono } from "hono";
import type Stripe from "stripe";

import { stripeClient } from "@/clients/stripe.client";
import { getEnv } from "@/config/env";
import { stripeWebhookService } from "@/services/stripe-webhook.service";

export default function mount(app: Hono) {
  app.post("/stripe", async (c) => {
    if (getEnv().USE_UNIFIED_STRIPE_WEBHOOK) {
      return c.json(
        {
          message:
            "POST /webhooks/stripe is disabled when USE_UNIFIED_STRIPE_WEBHOOK is enabled. Send billing events to POST /auth/stripe/webhook instead.",
        },
        410,
      );
    }

    const signature = c.req.header("stripe-signature");
    if (!signature) {
      return c.json({ message: "Missing stripe-signature header" }, 400);
    }

    // Signature verification needs the exact raw body, so this route stays
    // outside the OpenAPI app and must not parse the payload before here.
    const payload = await c.req.text();

    let event: Stripe.Event;
    try {
      event = await stripeClient.constructWebhookEvent(payload, signature);
    } catch (error) {
      console.warn(
        "[webhooks/stripe] Signature verification failed:",
        error instanceof Error ? error.message : error,
      );
      return c.json({ message: "Invalid signature" }, 400);
    }

    try {
      await stripeWebhookService.handleEvent(event);
    } catch (error) {
      console.error(
        `[webhooks/stripe] Handler failed for ${event.type} (${event.id}):`,
        error,
      );
      // 5xx so Stripe retries the event.
      return c.json({ message: "Webhook handler failed" }, 500);
    }

    return c.json({ received: true }, 200);
  });
}
