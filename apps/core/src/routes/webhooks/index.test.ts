import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { constructWebhookEventMock, getEnvMock, handleEventMock } = vi.hoisted(
  () => ({
    constructWebhookEventMock: vi.fn(),
    getEnvMock: vi.fn(),
    handleEventMock: vi.fn(),
  }),
);

vi.mock("@/config/env", () => ({
  getEnv: () => getEnvMock(),
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    constructWebhookEvent: constructWebhookEventMock,
  },
}));

vi.mock("@/services/stripe-webhook.service", () => ({
  stripeWebhookService: {
    handleEvent: handleEventMock,
  },
}));

async function createApp() {
  const { default: webhooksRouter } = await import("./index");
  const app = new Hono();
  app.route("/webhooks", webhooksRouter);
  return app;
}

function postStripeWebhook(
  app: Hono,
  options: { body?: string; signature?: string } = {},
) {
  const { body = "{}", signature } = options;
  return app.request("http://localhost/webhooks/stripe", {
    method: "POST",
    body,
    headers: signature ? { "stripe-signature": signature } : {},
  });
}

describe("POST /webhooks/stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ USE_UNIFIED_STRIPE_WEBHOOK: false });
    constructWebhookEventMock.mockResolvedValue({
      id: "evt_123",
      type: "customer.updated",
      data: { object: { id: "cus_123" } },
    });
    handleEventMock.mockResolvedValue(undefined);
  });

  it("returns 400 when the stripe-signature header is missing", async () => {
    const app = await createApp();

    const response = await postStripeWebhook(app);

    expect(response.status).toBe(400);
    expect(constructWebhookEventMock).not.toHaveBeenCalled();
    expect(handleEventMock).not.toHaveBeenCalled();
  });

  it("returns 400 when signature verification fails", async () => {
    constructWebhookEventMock.mockRejectedValue(
      new Error("No signatures found matching the expected signature"),
    );
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      const app = await createApp();

      const response = await postStripeWebhook(app, {
        signature: "t=1,v1=bad",
      });

      expect(response.status).toBe(400);
      expect(handleEventMock).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("verifies the raw body against the signature header", async () => {
    const app = await createApp();
    const body = JSON.stringify({ id: "evt_123" });

    const response = await postStripeWebhook(app, {
      body,
      signature: "t=1,v1=abc",
    });

    expect(response.status).toBe(200);
    expect(constructWebhookEventMock).toHaveBeenCalledWith(body, "t=1,v1=abc");
  });

  it("dispatches the verified event and returns 200", async () => {
    const app = await createApp();

    const response = await postStripeWebhook(app, { signature: "t=1,v1=abc" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(handleEventMock).toHaveBeenCalledTimes(1);
    expect(handleEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "evt_123", type: "customer.updated" }),
    );
  });

  it("returns 410 when unified stripe webhooks are enabled", async () => {
    getEnvMock.mockReturnValue({ USE_UNIFIED_STRIPE_WEBHOOK: true });
    const app = await createApp();

    const response = await postStripeWebhook(app, { signature: "t=1,v1=abc" });

    expect(response.status).toBe(410);
    expect(constructWebhookEventMock).not.toHaveBeenCalled();
    expect(handleEventMock).not.toHaveBeenCalled();
  });

  it("returns 500 when the handler fails so Stripe retries", async () => {
    handleEventMock.mockRejectedValue(new Error("db down"));
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const app = await createApp();

      const response = await postStripeWebhook(app, {
        signature: "t=1,v1=abc",
      });

      expect(response.status).toBe(500);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
