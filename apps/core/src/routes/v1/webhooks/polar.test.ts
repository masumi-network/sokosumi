import { OpenAPIHono } from "@hono/zod-openapi";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";

import router from "./index";

/** Credits are stored as cents, base 10^10 (apps/core/AGENTS.md). */
const CENTS_PER_CREDIT = 10_000_000_000n;

const m = vi.hoisted(() => ({
  verifyPolarWebhook: vi.fn(),
  captureMessage: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    cmoSubscription: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    project: { findFirst: vi.fn() },
    task: { findMany: vi.fn() },
    transaction: { create: vi.fn() },
  },
}));

vi.mock("@/clients/polar.client", () => ({
  verifyPolarWebhook: m.verifyPolarWebhook,
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(), verifyApiKey: vi.fn() } },
}));
vi.mock("@/lib/db/prisma", () => ({ default: m.prisma }));
vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  captureMessage: m.captureMessage,
}));

const URL = "http://localhost/v1/webhooks/polar";
const BODY = JSON.stringify({ type: "order.paid", data: { id: "order_1" } });

const ORGANIZATION_ID = "org_1";
const PROJECT_ID = "0190a000-0000-7000-8000-000000000001";
const METADATA = {
  projectId: PROJECT_ID,
  organizationId: ORGANIZATION_ID,
  userId: "user_1",
};
const ROW = {
  id: "0190a000-0000-7000-8000-0000000000aa",
  projectId: PROJECT_ID,
  organizationId: ORGANIZATION_ID,
};
const PLAN_PRODUCT = {
  id: "prod_growth_month",
  name: "Growth",
  metadata: { kind: "plan", tier: "growth", credits: "25000" },
};
const SUBSCRIPTION = {
  id: "sub_1",
  status: "active",
  product_id: PLAN_PRODUCT.id,
  recurring_interval: "month",
  current_period_start: "2026-11-13T10:00:00.000Z",
  current_period_end: "2026-12-13T10:00:00.000Z",
  cancel_at_period_end: false,
  ended_at: null,
};

function orderPaid(order: Record<string, unknown> = {}) {
  return ok({
    type: "order.paid",
    timestamp: "2026-11-13T10:00:05.000Z",
    data: {
      id: "order_1",
      billing_reason: "subscription_create",
      metadata: METADATA,
      customer: { id: "cus_1", external_id: ORGANIZATION_ID },
      product: PLAN_PRODUCT,
      subscription: SUBSCRIPTION,
      ...order,
    },
  });
}

function subscriptionEvent(
  type: string,
  timestamp: string,
  subscription: Record<string, unknown> = {},
) {
  return ok({
    type,
    timestamp,
    data: {
      ...SUBSCRIPTION,
      metadata: METADATA,
      customer: { id: "cus_1", external_id: ORGANIZATION_ID },
      product: PLAN_PRODUCT,
      pending_update: null,
      ...subscription,
    },
  });
}

/** What the handler wrote as the grant: the transaction and its bucket. */
function grant() {
  return m.prisma.transaction.create.mock.calls[0]?.[0].data;
}

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
  m.prisma.$transaction.mockImplementation((run) => run(m.prisma));
  m.prisma.cmoSubscription.updateMany.mockResolvedValue({ count: 0 });
  m.prisma.cmoSubscription.findUnique.mockResolvedValue(null);
  m.prisma.cmoSubscription.create.mockResolvedValue(ROW);
  m.prisma.project.findFirst.mockResolvedValue({ id: PROJECT_ID });
  m.prisma.task.findMany.mockResolvedValue([]);
  m.prisma.transaction.create.mockResolvedValue({ id: "tx_1" });
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

  it("verifies the raw body with the webhook headers", async () => {
    m.verifyPolarWebhook.mockResolvedValue(err("invalid_signature"));

    await post();

    expect(m.verifyPolarWebhook).toHaveBeenCalledWith(BODY, {
      "webhook-id": "msg_1",
      "webhook-timestamp": "1700000000",
      "webhook-signature": "v1,c2lnbmF0dXJl",
    });
  });

  describe("order.paid for the first order of a CMO plan", () => {
    it("grants the plan's monthly credits as Project credits until the period ends", async () => {
      m.verifyPolarWebhook.mockResolvedValue(orderPaid());

      const response = await post();

      expect(response.status).toBe(200);
      expect(m.prisma.transaction.create).toHaveBeenCalledTimes(1);
      expect(grant()).toEqual({
        amount: 25_000n * CENTS_PER_CREDIT,
        organizationId: ORGANIZATION_ID,
        userId: null,
        sourceCreditBucket: {
          create: {
            amount: 25_000n * CENTS_PER_CREDIT,
            expiresAt: new Date("2026-12-13T10:00:00.000Z"),
            organizationId: ORGANIZATION_ID,
            projectId: PROJECT_ID,
            referenceId: "order_1:0",
            referenceNote: "Growth",
            referenceType: "CMO_SUBSCRIPTION_MONTH",
            userId: null,
          },
        },
      });
    });

    it("records the subscription and its last paid order", async () => {
      m.verifyPolarWebhook.mockResolvedValue(orderPaid());

      await post();

      expect(m.prisma.cmoSubscription.create.mock.calls[0]?.[0].data).toEqual({
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date("2026-12-13T10:00:00.000Z"),
        currentPeriodStart: new Date("2026-11-13T10:00:00.000Z"),
        endedAt: null,
        interval: "month",
        organizationId: ORGANIZATION_ID,
        polarEventAt: new Date("2026-11-13T10:00:05.000Z"),
        polarProductId: "prod_growth_month",
        polarSubscriptionId: "sub_1",
        projectId: PROJECT_ID,
        status: "active",
        tier: "growth",
      });
      expect(m.prisma.cmoSubscription.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: {
            lastPaidAt: new Date("2026-11-13T10:00:05.000Z"),
            lastPaidOrderRefundedAt: null,
            lastPaidOrderId: "order_1",
          },
        }),
      );
    });

    it("lets a yearly plan's first month expire one month after the period starts", async () => {
      m.verifyPolarWebhook.mockResolvedValue(
        orderPaid({
          subscription: {
            ...SUBSCRIPTION,
            recurring_interval: "year",
            current_period_end: "2027-11-13T10:00:00.000Z",
          },
        }),
      );

      await post();

      expect(grant().sourceCreditBucket.create).toMatchObject({
        amount: 25_000n * CENTS_PER_CREDIT,
        expiresAt: new Date("2026-12-13T10:00:00.000Z"),
        referenceId: "order_1:0",
      });
    });

    it("starts a renewed yearly plan's twelve months again with the renewal order", async () => {
      m.prisma.cmoSubscription.findUnique.mockResolvedValue(ROW);
      m.verifyPolarWebhook.mockResolvedValue(
        orderPaid({
          id: "order_2",
          billing_reason: "subscription_cycle",
          metadata: {},
          subscription: {
            ...SUBSCRIPTION,
            recurring_interval: "year",
            current_period_start: "2027-11-13T10:00:00.000Z",
            current_period_end: "2028-11-13T10:00:00.000Z",
          },
        }),
      );

      const response = await post();

      expect(response.status).toBe(200);
      expect(grant().sourceCreditBucket.create).toMatchObject({
        amount: 25_000n * CENTS_PER_CREDIT,
        expiresAt: new Date("2027-12-13T10:00:00.000Z"),
        referenceId: "order_2:0",
      });
      expect(m.prisma.cmoSubscription.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: {
            lastPaidAt: new Date("2026-11-13T10:00:05.000Z"),
            lastPaidOrderRefundedAt: null,
            lastPaidOrderId: "order_2",
          },
        }),
      );
    });

    it("takes the Project from the stored subscription before the order's metadata", async () => {
      const storedProjectId = "0190a000-0000-7000-8000-000000000002";
      m.prisma.cmoSubscription.findUnique.mockResolvedValue({
        ...ROW,
        projectId: storedProjectId,
      });
      m.verifyPolarWebhook.mockResolvedValue(orderPaid({ metadata: {} }));

      await post();

      expect(m.prisma.cmoSubscription.create).not.toHaveBeenCalled();
      expect(grant().sourceCreditBucket.create.projectId).toBe(storedProjectId);
    });

    it("answers 200 and grants nothing more when the order is delivered again", async () => {
      m.prisma.cmoSubscription.findUnique.mockResolvedValue(ROW);
      m.prisma.transaction.create.mockRejectedValue(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );
      m.verifyPolarWebhook.mockResolvedValue(orderPaid());

      const response = await post();

      expect(response.status).toBe(200);
      expect(m.captureMessage).not.toHaveBeenCalled();
    });

    it("answers 500 when the grant cannot be written, so Polar delivers again", async () => {
      m.prisma.transaction.create.mockRejectedValue(new Error("db down"));
      m.verifyPolarWebhook.mockResolvedValue(orderPaid());

      const response = await post();

      expect(response.status).toBe(500);
    });

    it.each([
      ["a Project the organization does not have", { id: "order_orphan" }],
      ["no checkout metadata", { metadata: {} }],
      [
        "a Polar customer that is not the checkout's organization",
        { customer: { id: "cus_2", external_id: "org_other" } },
      ],
      [
        "a product that is not a CMO plan",
        { product: { ...PLAN_PRODUCT, metadata: {} } },
      ],
    ])(
      "reports an order with %s to Sentry and acknowledges it",
      async (_name, order) => {
        if ("id" in order) m.prisma.project.findFirst.mockResolvedValue(null);
        m.verifyPolarWebhook.mockResolvedValue(orderPaid(order));

        const response = await post();

        expect(response.status).toBe(200);
        expect(m.captureMessage).toHaveBeenCalledTimes(1);
        expect(m.prisma.cmoSubscription.create).not.toHaveBeenCalled();
        expect(m.prisma.transaction.create).not.toHaveBeenCalled();
      },
    );

    it("looks the Project up inside the organization", async () => {
      m.verifyPolarWebhook.mockResolvedValue(orderPaid());

      await post();

      expect(m.prisma.project.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: PROJECT_ID,
            workspace: { organizationId: ORGANIZATION_ID },
          },
        }),
      );
    });

    it("acknowledges a metered cycle order without granting", async () => {
      m.verifyPolarWebhook.mockResolvedValue(
        orderPaid({ billing_reason: "subscription_meter_cycle" }),
      );

      const response = await post();

      expect(response.status).toBe(200);
      expect(m.prisma.transaction.create).not.toHaveBeenCalled();
    });
  });

  describe("subscription events", () => {
    it.each([
      "subscription.created",
      "subscription.active",
      "subscription.updated",
    ])("%s records a subscription Core has not seen", async (type) => {
      m.verifyPolarWebhook.mockResolvedValue(
        subscriptionEvent(type, "2026-11-13T10:00:03.000Z", {
          cancel_at_period_end: true,
          pending_update: { product_id: "prod_starter_month" },
        }),
      );

      const response = await post();

      expect(response.status).toBe(200);
      expect(m.prisma.cmoSubscription.create.mock.calls[0]?.[0].data).toEqual({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date("2026-12-13T10:00:00.000Z"),
        currentPeriodStart: new Date("2026-11-13T10:00:00.000Z"),
        endedAt: null,
        interval: "month",
        organizationId: ORGANIZATION_ID,
        pendingPolarProductId: "prod_starter_month",
        polarEventAt: new Date("2026-11-13T10:00:03.000Z"),
        polarProductId: "prod_growth_month",
        polarSubscriptionId: "sub_1",
        projectId: PROJECT_ID,
        status: "active",
        tier: "growth",
      });
      expect(m.prisma.transaction.create).not.toHaveBeenCalled();
    });

    it("writes a stored subscription only when the payload is not older than its state", async () => {
      m.prisma.cmoSubscription.findUnique.mockResolvedValue(ROW);
      m.verifyPolarWebhook.mockResolvedValue(
        subscriptionEvent("subscription.updated", "2026-11-13T10:00:03.000Z", {
          status: "past_due",
        }),
      );

      const response = await post();

      expect(response.status).toBe(200);
      expect(m.prisma.cmoSubscription.updateMany).toHaveBeenCalledWith({
        where: {
          polarSubscriptionId: "sub_1",
          polarEventAt: { lte: new Date("2026-11-13T10:00:03.000Z") },
        },
        data: expect.objectContaining({
          pendingPolarProductId: null,
          polarEventAt: new Date("2026-11-13T10:00:03.000Z"),
          status: "past_due",
        }),
      });
      expect(m.prisma.cmoSubscription.create).not.toHaveBeenCalled();
    });

    it("marks a subscription ended when Polar's status says so", async () => {
      m.verifyPolarWebhook.mockResolvedValue(
        subscriptionEvent("subscription.updated", "2026-11-13T10:00:03.000Z", {
          status: "canceled",
          ended_at: "2026-11-13T10:00:02.000Z",
        }),
      );

      await post();

      expect(
        m.prisma.cmoSubscription.create.mock.calls[0]?.[0].data.endedAt,
      ).toEqual(new Date("2026-11-13T10:00:02.000Z"));
    });

    it("reports a subscription for an unknown Project to Sentry and acknowledges it", async () => {
      m.prisma.project.findFirst.mockResolvedValue(null);
      m.verifyPolarWebhook.mockResolvedValue(
        subscriptionEvent("subscription.created", "2026-11-13T10:00:03.000Z"),
      );

      const response = await post();

      expect(response.status).toBe(200);
      expect(m.captureMessage).toHaveBeenCalledTimes(1);
      expect(m.prisma.cmoSubscription.create).not.toHaveBeenCalled();
    });

    it("reports a second live subscription for one Project and acknowledges it", async () => {
      m.prisma.cmoSubscription.create.mockRejectedValue(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );
      m.verifyPolarWebhook.mockResolvedValue(
        subscriptionEvent("subscription.created", "2026-11-13T10:00:03.000Z"),
      );

      const response = await post();

      expect(response.status).toBe(200);
      expect(m.captureMessage).toHaveBeenCalledTimes(1);
    });
  });
});
