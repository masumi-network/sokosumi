import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PolarWebhookEvent } from "@/clients/polar.client";
import {
  ga4PayloadForPolarEvent,
  reportPolarEventToGa4,
} from "@/services/ga4-measurement.service";

const m = vi.hoisted(() => ({
  env: {} as { GA4_MP_API_SECRET?: string },
  captureException: vi.fn(),
}));
vi.mock("@/config/env", () => ({ getEnv: () => m.env }));
vi.mock("@sentry/node", () => ({ captureException: m.captureException }));

const GA = {
  ga_client_id: "123456789.1764000000",
  ga_session_id: "1764070000",
};
const CHECKOUT = {
  kind: "plan",
  projectId: "p1",
  organizationId: "o1",
  userId: "user_1",
};
const PRODUCT = {
  id: "prod_growth",
  name: "Growth",
  metadata: { kind: "plan", tier: "growth", credits: "25000" },
};

function orderPaid(order: Record<string, unknown> = {}): PolarWebhookEvent {
  return {
    type: "order.paid",
    timestamp: "2026-11-25T10:00:00.000Z",
    data: {
      id: "order_1",
      billing_reason: "subscription_create",
      net_amount: 50000,
      tax_amount: 0,
      refunded_amount: 0,
      currency: "usd",
      metadata: { ...CHECKOUT, ...GA },
      product: PRODUCT,
      subscription: {
        id: "sub_1",
        recurring_interval: "month",
        metadata: { ...CHECKOUT, ...GA },
      },
      ...order,
    },
  } as unknown as PolarWebhookEvent;
}

beforeEach(() => {
  m.env = {};
  m.captureException.mockReset();
});

describe("ga4PayloadForPolarEvent", () => {
  it("reports a first plan payment as a purchase in its checkout's session", () => {
    expect(ga4PayloadForPolarEvent(orderPaid())).toEqual({
      client_id: GA.ga_client_id,
      user_id: "user_1",
      timestamp_micros: Date.parse("2026-11-25T10:00:00.000Z") * 1000,
      events: [
        {
          name: "purchase",
          params: {
            transaction_id: "order_1",
            value: 500,
            tax: 0,
            currency: "USD",
            billing_reason: "subscription_create",
            plan: "growth",
            billing_period: "month",
            items: [
              {
                item_id: "growth",
                item_name: "Growth",
                item_category: "plan",
                item_variant: "month",
                price: 500,
                quantity: 1,
              },
            ],
            session_id: GA.ga_session_id,
            engagement_time_msec: 1,
          },
        },
      ],
    });
  });

  it("reports a renewal from the subscription's metadata, outside the old session", () => {
    const payload = ga4PayloadForPolarEvent(
      orderPaid({ billing_reason: "subscription_cycle", metadata: {} }),
    );
    expect(payload?.client_id).toBe(GA.ga_client_id);
    expect(payload?.events[0]?.params).not.toHaveProperty("session_id");
    expect(payload?.events[0]?.params.billing_reason).toBe(
      "subscription_cycle",
    );
  });

  it("reports nothing for a checkout without analytics consent", () => {
    const withoutIds = {
      metadata: CHECKOUT,
      subscription: {
        id: "sub_1",
        recurring_interval: "month",
        metadata: CHECKOUT,
      },
    };
    expect(ga4PayloadForPolarEvent(orderPaid(withoutIds))).toBeNull();
  });

  it("reports a refund by its order id and refunded amount", () => {
    const refund = {
      ...orderPaid({ refunded_amount: 20000 }),
      type: "order.refunded",
    } as PolarWebhookEvent;
    expect(ga4PayloadForPolarEvent(refund)?.events[0]).toEqual({
      name: "refund",
      params: {
        transaction_id: "order_1",
        value: 200,
        currency: "USD",
        session_id: GA.ga_session_id,
        engagement_time_msec: 1,
      },
    });
  });

  it("reports a cancellation with its plan", () => {
    const canceled = {
      type: "subscription.canceled",
      timestamp: "2026-11-25T10:00:00.000Z",
      data: {
        metadata: { ...CHECKOUT, ...GA },
        product: PRODUCT,
        recurring_interval: "year",
        cancel_at_period_end: true,
      },
    } as unknown as PolarWebhookEvent;
    expect(ga4PayloadForPolarEvent(canceled)?.events[0]).toEqual({
      name: "subscription_cancel",
      params: {
        plan: "growth",
        billing_period: "year",
        cancel_at_period_end: true,
        engagement_time_msec: 1,
      },
    });
  });
});

describe("reportPolarEventToGa4", () => {
  it("sends nothing until the secret is set", async () => {
    const send = vi.fn();
    await reportPolarEventToGa4(orderPaid(), send);
    expect(send).not.toHaveBeenCalled();
  });

  it("posts the payload to the Measurement Protocol and reports a refusal without throwing", async () => {
    m.env = { GA4_MP_API_SECRET: "secret" };
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    await reportPolarEventToGa4(orderPaid(), send);
    const [url, init] = send.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://www.google-analytics.com/mp/collect?measurement_id=G-82QM6MPVWK&api_secret=secret",
    );
    expect(JSON.parse(init.body).events[0].name).toBe("purchase");
    expect(m.captureException).toHaveBeenCalledOnce();
  });
});
