import { Hono } from "hono";
import { describe, expect, it } from "vitest";

async function createApp() {
  const { default: webhooksRouter } = await import("./index");
  const app = new Hono();
  app.route("/webhooks", webhooksRouter);
  return app;
}

function postStripeWebhook(app: Hono) {
  return app.request("http://localhost/webhooks/stripe", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": "t=1,v1=abc" },
  });
}

describe("POST /webhooks/stripe", () => {
  it("returns 410 because Stripe events must use POST /auth/stripe/webhook", async () => {
    const app = await createApp();

    const response = await postStripeWebhook(app);

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      message:
        "POST /webhooks/stripe is disabled. Send Stripe events to POST /auth/stripe/webhook instead.",
    });
  });
});
