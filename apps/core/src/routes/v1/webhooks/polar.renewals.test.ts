import { OpenAPIHono } from "@hono/zod-openapi";
import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";

import router from "./index";

/**
 * A monthly CMO subscription after its first payment: renewals, a failed
 * renewal and its late collection, cancel, uncancel and revoke (ADR 0068).
 */

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

const ORGANIZATION_ID = "org_1";
const PROJECT_ID = "0190a000-0000-7000-8000-000000000001";
/** The row the first order stored; a renewal carries no checkout metadata. */
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
/** The second month, after Polar rolled the period over. */
const SUBSCRIPTION = {
  id: "sub_1",
  status: "active",
  product_id: PLAN_PRODUCT.id,
  recurring_interval: "month",
  current_period_start: "2026-12-13T10:00:00.000Z",
  current_period_end: "2027-01-13T10:00:00.000Z",
  cancel_at_period_end: false,
  ended_at: null,
};

function renewalPaid(
  timestamp = "2026-12-13T10:00:05.000Z",
  order: Record<string, unknown> = {},
) {
  return ok({
    type: "order.paid",
    timestamp,
    data: {
      id: "order_2",
      billing_reason: "subscription_cycle",
      metadata: {},
      customer: { id: "cus_1", external_id: ORGANIZATION_ID },
      product: PLAN_PRODUCT,
      subscription: SUBSCRIPTION,
      items: [],
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
      metadata: {},
      customer: { id: "cus_1", external_id: ORGANIZATION_ID },
      product: PLAN_PRODUCT,
      pending_update: null,
      ...subscription,
    },
  });
}

/** The credit buckets the handler granted. */
function grants() {
  return m.prisma.transaction.create.mock.calls.map(
    ([args]) => args.data.sourceCreditBucket.create,
  );
}

/** The state the handler wrote to the stored subscription row. */
function storedState() {
  return m.prisma.cmoSubscription.updateMany.mock.calls[0]?.[0];
}

function post() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "polar_webhook_test");
    await next();
  });
  app.onError(errorHandler);
  app.route("/v1/webhooks", router);
  return app.request("http://localhost/v1/webhooks/polar", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "webhook-id": "msg_1",
      "webhook-timestamp": "1700000000",
      "webhook-signature": "v1,c2lnbmF0dXJl",
    },
    body: "{}",
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.prisma.$transaction.mockImplementation((run) => run(m.prisma));
  m.prisma.cmoSubscription.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.cmoSubscription.findUnique.mockResolvedValue(ROW);
  m.prisma.task.findMany.mockResolvedValue([]);
  m.prisma.transaction.create.mockResolvedValue({ id: "tx_1" });
});

describe("POST /v1/webhooks/polar after the first payment", () => {
  describe("a paid renewal", () => {
    it("grants the tier's monthly credits, keyed by that order, until its period ends", async () => {
      m.verifyPolarWebhook.mockResolvedValue(renewalPaid());

      const response = await post();

      expect(response.status).toBe(200);
      expect(grants()).toEqual([
        {
          amount: 25_000n * CENTS_PER_CREDIT,
          expiresAt: new Date("2027-01-13T10:00:00.000Z"),
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          referenceId: "order_2:0",
          referenceNote: "Growth",
          referenceType: "CMO_SUBSCRIPTION_MONTH",
          userId: null,
        },
      ]);
    });

    it("takes the month from the order's own line when the delivery is late", async () => {
      m.verifyPolarWebhook.mockResolvedValue(
        renewalPaid("2027-01-13T10:00:09.000Z", {
          items: [
            {
              proration: false,
              start_timestamp: "2026-12-13T10:00:00.000Z",
              end_timestamp: "2027-01-13T10:00:00.000Z",
            },
          ],
          subscription: {
            ...SUBSCRIPTION,
            current_period_start: "2027-01-13T10:00:00.000Z",
            current_period_end: "2027-02-13T10:00:00.000Z",
          },
        }),
      );

      await post();

      expect(grants()).toMatchObject([
        {
          expiresAt: new Date("2027-01-13T10:00:00.000Z"),
          referenceId: "order_2:0",
        },
      ]);
    });
  });

  describe("a renewal Polar could not collect", () => {
    it("grants nothing when the period rolls over without a paid order", async () => {
      m.verifyPolarWebhook.mockResolvedValue(
        subscriptionEvent("subscription.cycled", "2026-12-13T10:00:01.000Z"),
      );

      const response = await post();

      expect(response.status).toBe(202);
      expect(grants()).toEqual([]);
    });

    it("leaves the subscription past due, without a grant", async () => {
      m.verifyPolarWebhook.mockResolvedValue(
        subscriptionEvent("subscription.past_due", "2026-12-13T10:05:00.000Z", {
          status: "past_due",
        }),
      );

      const response = await post();

      expect(response.status).toBe(200);
      expect(storedState()).toEqual({
        where: {
          polarSubscriptionId: "sub_1",
          polarEventAt: { lte: new Date("2026-12-13T10:05:00.000Z") },
        },
        data: {
          cancelAtPeriodEnd: false,
          currentPeriodEnd: new Date("2027-01-13T10:00:00.000Z"),
          currentPeriodStart: new Date("2026-12-13T10:00:00.000Z"),
          endedAt: null,
          interval: "month",
          pendingPolarProductId: null,
          polarEventAt: new Date("2026-12-13T10:05:00.000Z"),
          polarProductId: "prod_growth_month",
          status: "past_due",
          tier: "growth",
        },
      });
      expect(grants()).toEqual([]);
    });

    it("grants that month once when Polar collects later", async () => {
      m.verifyPolarWebhook.mockResolvedValue(
        renewalPaid("2026-12-15T08:00:00.000Z"),
      );

      const response = await post();

      expect(response.status).toBe(200);
      expect(grants()).toMatchObject([
        {
          amount: 25_000n * CENTS_PER_CREDIT,
          expiresAt: new Date("2027-01-13T10:00:00.000Z"),
          referenceId: "order_2:0",
        },
      ]);
      expect(storedState().data.status).toBe("active");
      expect(m.prisma.cmoSubscription.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: {
            lastPaidAt: new Date("2026-12-15T08:00:00.000Z"),
            lastPaidOrderId: "order_2",
          },
        }),
      );
    });

    it("grants nothing more when the late payment is delivered again", async () => {
      m.prisma.transaction.create.mockRejectedValue(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );
      m.verifyPolarWebhook.mockResolvedValue(
        renewalPaid("2026-12-15T08:00:00.000Z"),
      );

      const response = await post();

      expect(response.status).toBe(200);
      expect(m.prisma.transaction.create.mock.calls[0]?.[0].data).toMatchObject(
        { sourceCreditBucket: { create: { referenceId: "order_2:0" } } },
      );
      expect(m.captureMessage).not.toHaveBeenCalled();
    });
  });

  describe("a cancel", () => {
    it("keeps the subscription active until the period ends", async () => {
      m.verifyPolarWebhook.mockResolvedValue(
        subscriptionEvent("subscription.canceled", "2026-12-20T09:00:00.000Z", {
          cancel_at_period_end: true,
        }),
      );

      const response = await post();

      expect(response.status).toBe(200);
      expect(storedState().data).toMatchObject({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date("2027-01-13T10:00:00.000Z"),
        endedAt: null,
        status: "active",
      });
    });

    it("is undone by an uncancel", async () => {
      m.verifyPolarWebhook.mockResolvedValue(
        subscriptionEvent(
          "subscription.uncanceled",
          "2026-12-21T09:00:00.000Z",
        ),
      );

      const response = await post();

      expect(response.status).toBe(200);
      expect(storedState()).toMatchObject({
        where: { polarEventAt: { lte: new Date("2026-12-21T09:00:00.000Z") } },
        data: { cancelAtPeriodEnd: false, endedAt: null, status: "active" },
      });
    });
  });

  describe("a revoke", () => {
    it.each([
      ["at the end of a canceled period", "canceled"],
      ["after every payment retry failed", "unpaid"],
    ])("ends the subscription %s", async (_name, status) => {
      m.verifyPolarWebhook.mockResolvedValue(
        subscriptionEvent("subscription.revoked", "2027-01-13T10:00:02.000Z", {
          status,
          ended_at: "2027-01-13T10:00:00.000Z",
        }),
      );

      const response = await post();

      expect(response.status).toBe(200);
      expect(storedState().data).toMatchObject({
        endedAt: new Date("2027-01-13T10:00:00.000Z"),
        status,
      });
      expect(grants()).toEqual([]);
    });

    it("ends the subscription when the payload names no end", async () => {
      m.verifyPolarWebhook.mockResolvedValue(
        subscriptionEvent("subscription.revoked", "2027-01-13T10:00:02.000Z", {
          status: "past_due",
        }),
      );

      await post();

      expect(storedState().data.endedAt).toEqual(
        new Date("2027-01-13T10:00:02.000Z"),
      );
    });

    it("leaves a row that ticket 08's revoke already ended as it is", async () => {
      // The ending path set polarEventAt to now, newer than Polar's event.
      m.prisma.cmoSubscription.updateMany.mockResolvedValue({ count: 0 });
      m.verifyPolarWebhook.mockResolvedValue(
        subscriptionEvent("subscription.revoked", "2027-01-13T10:00:02.000Z", {
          status: "canceled",
          ended_at: "2027-01-13T10:00:00.000Z",
        }),
      );

      const response = await post();

      expect(response.status).toBe(200);
      expect(m.captureMessage).not.toHaveBeenCalled();
      expect(m.prisma.cmoSubscription.create).not.toHaveBeenCalled();
      expect(grants()).toEqual([]);
    });
  });
});
