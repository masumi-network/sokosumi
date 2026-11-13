import { OpenAPIHono } from "@hono/zod-openapi";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";

import router from "./index";

const m = vi.hoisted(() => ({ verifyPolarWebhook: vi.fn() }));

vi.mock("@/clients/polar.client", () => ({
  verifyPolarWebhook: m.verifyPolarWebhook,
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(), verifyApiKey: vi.fn() } },
}));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));

const URL = "http://localhost/v1/webhooks/polar";
const BODY = JSON.stringify({ type: "order.paid", data: { id: "order_1" } });

function post() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "polar_webhook_test");
    await next();
  });
  app.onError(errorHandler);
  app.route("/v1/webhooks", router);
  return app.request(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "webhook-id": "msg_1",
      "webhook-timestamp": "1700000000",
      "webhook-signature": "v1,c2lnbmF0dXJl",
    },
    body: BODY,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /v1/webhooks/polar", () => {
  it("answers 503 when Polar is not configured", async () => {
    m.verifyPolarWebhook.mockResolvedValue(err("not_configured"));

    const response = await post();

    expect(response.status).toBe(503);
  });

  it("answers 403 on a bad signature", async () => {
    m.verifyPolarWebhook.mockResolvedValue(err("invalid_signature"));

    const response = await post();

    expect(response.status).toBe(403);
  });

  it("answers 202 on an event type the SDK does not know", async () => {
    m.verifyPolarWebhook.mockResolvedValue(err("unsupported_event"));

    const response = await post();

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ received: true });
  });

  it("answers 202 on an event type Core does not handle", async () => {
    m.verifyPolarWebhook.mockResolvedValue(
      ok({ type: "customer.created", data: { id: "customer_1" } }),
    );

    const response = await post();

    expect(response.status).toBe(202);
  });

  it.each([
    "order.paid",
    "order.refunded",
    "subscription.created",
    "subscription.active",
    "subscription.updated",
    "subscription.canceled",
    "subscription.uncanceled",
    "subscription.past_due",
    "subscription.revoked",
  ])("answers 200 on %s", async (type) => {
    m.verifyPolarWebhook.mockResolvedValue(ok({ type, data: { id: "id_1" } }));

    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { received: true },
    });
  });

  it("verifies the raw body with the webhook headers", async () => {
    m.verifyPolarWebhook.mockResolvedValue(err("invalid_signature"));

    await post();

    expect(m.verifyPolarWebhook).toHaveBeenCalledWith(BODY, {
      "webhook-id": "msg_1",
      "webhook-timestamp": "1700000000",
      "webhook-signature": "v1,c2lnbmF0dXJl",
    });
  });
});
