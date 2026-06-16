import type { Hono } from "hono";

export default function mount(app: Hono) {
  app.post("/stripe", (c) => {
    return c.json(
      {
        message:
          "POST /webhooks/stripe is disabled. Send Stripe events to POST /auth/stripe/webhook instead.",
      },
      410,
    );
  });
}
