import { OpenAPIHono } from "@hono/zod-openapi";
import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";

import router from "./index";

/**
 * A CMO plan change (ADR 0068): an upgrade's paid `subscription_update` order
 * grants the prorated extra credits; a downgrade waits as the pending tier
 * until Polar applies it at the renewal.
 */

/** Credits are stored as cents, base 10^10 (apps/core/AGENTS.md). */
const CENTS_PER_CREDIT = 10_000_000_000n;

const m = vi.hoisted(() => ({
  verifyPolarWebhook: vi.fn(),
  captureMessage: vi.fn(),
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    polarSubscription: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    project: { findFirst: vi.fn() },
    sokoBot: { findFirst: vi.fn(), updateMany: vi.fn() },
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
const ROW = {
  id: "0190a000-0000-7000-8000-0000000000aa",
  projectId: PROJECT_ID,
  organizationId: ORGANIZATION_ID,
};
const GROWTH = {
  id: "prod_growth_month",
  name: "Growth",
  metadata: { kind: "plan", tier: "growth", credits: "25000" },
};
const SCALE = {
  id: "prod_scale_month",
  name: "Scale",
  metadata: { kind: "plan", tier: "scale", credits: "50000" },
};
/** A 31-day month that started on December 13th. */
const SUBSCRIPTION = {
  id: "sub_1",
  status: "active",
  product_id: GROWTH.id,
  recurring_interval: "month",
  current_period_start: "2026-12-13T10:00:00.000Z",
  current_period_end: "2027-01-13T10:00:00.000Z",
  cancel_at_period_end: false,
  ended_at: null,
  metadata: {},
};

/** The upgrade to Scale, paid halfway through the month. */
function upgradePaid(
  timestamp = "2026-12-28T22:00:00.000Z",
  subscription: Record<string, unknown> = {},
  createdAt = timestamp,
) {
  return ok({
    type: "order.paid",
    timestamp,
    data: {
      id: "order_3",
      created_at: createdAt,
      billing_reason: "subscription_update",
      metadata: {},
      customer: { id: "cus_1", external_id: ORGANIZATION_ID },
      product: SCALE,
      subscription: {
        ...SUBSCRIPTION,
        product_id: SCALE.id,
        metadata: { projectId: PROJECT_ID, upgradeFromCredits: 25_000 },
        ...subscription,
      },
      items: [
        { proration: true, start_timestamp: timestamp, end_timestamp: null },
      ],
    },
  });
}

function subscriptionUpdated(
  timestamp: string,
  subscription: Record<string, unknown>,
) {
  return ok({
    type: "subscription.updated",
    timestamp,
    data: {
      ...SUBSCRIPTION,
      customer: { id: "cus_1", external_id: ORGANIZATION_ID },
      product: GROWTH,
      pending_update: null,
      ...subscription,
    },
  });
}

function grants() {
  return m.prisma.transaction.create.mock.calls.map(
    ([args]) => args.data.sourceCreditBucket.create,
  );
}

/** Every write to the stored subscription row. */
function rowWrites() {
  return m.prisma.polarSubscription.updateMany.mock.calls.map(
    ([args]) => args.data,
  );
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
  // The grant's locked subscription row, live, and its live Cuso.
  m.prisma.$queryRaw.mockResolvedValue([
    {
      projectId: PROJECT_ID,
      endedAt: null,
      lastPaidOrderId: null,
      lastPaidOrderRefundedAt: null,
    },
  ]);
  m.prisma.sokoBot.findFirst.mockResolvedValue({ id: "bot_1" });
  // The grant write-locks the live Cuso's row.
  m.prisma.sokoBot.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.polarSubscription.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.polarSubscription.findUnique.mockResolvedValue(ROW);
  m.prisma.task.findMany.mockResolvedValue([]);
  m.prisma.transaction.create.mockResolvedValue({ id: "tx_1" });
});

describe("POST /v1/webhooks/polar: a paid upgrade", () => {
  it("grants the new monthly amount minus the old, times the month left, with the month's expiry", async () => {
    m.verifyPolarWebhook.mockResolvedValue(upgradePaid());

    const response = await post();

    expect(response.status).toBe(200);
    // (50,000 - 25,000) x 15.5 of 31 days.
    expect(grants()).toEqual([
      {
        amount: 12_500n * CENTS_PER_CREDIT,
        expiresAt: new Date("2027-01-13T10:00:00.000Z"),
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        referenceId: "order_3:0",
        referenceNote: "Scale",
        referenceType: "POLAR_SUBSCRIPTION_MONTH",
        userId: null,
      },
    ]);
  });

  it("counts the month left from when the order was made, not when it was delivered", async () => {
    m.verifyPolarWebhook.mockResolvedValue(
      // Delivered a week after Polar invoiced it halfway through the month.
      upgradePaid("2027-01-04T22:00:00.000Z", {}, "2026-12-28T22:00:00.000Z"),
    );

    await post();

    expect(grants()[0]?.amount).toBe(12_500n * CENTS_PER_CREDIT);
  });

  it("grants once per order: a redelivery ends on the bucket's key", async () => {
    m.verifyPolarWebhook.mockResolvedValue(upgradePaid());
    m.prisma.transaction.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["referenceId", "referenceType"] },
      }),
    );

    const response = await post();

    expect(response.status).toBe(200);
    expect(m.prisma.transaction.create).toHaveBeenCalledOnce();
  });

  it("grants a yearly plan's extra for the running month only, and leaves the paid order alone", async () => {
    m.verifyPolarWebhook.mockResolvedValue(
      // February 13th to March 13th: 28 days, 14 of them left.
      upgradePaid("2027-02-27T10:00:00.000Z", {
        recurring_interval: "year",
        current_period_start: "2026-11-13T10:00:00.000Z",
        current_period_end: "2027-11-13T10:00:00.000Z",
      }),
    );

    await post();

    expect(grants()).toMatchObject([
      {
        amount: 12_500n * CENTS_PER_CREDIT,
        expiresAt: new Date("2027-03-13T10:00:00.000Z"),
        referenceId: "order_3:0",
      },
    ]);
    // The yearly grant job counts months from the last paid order.
    expect(rowWrites()).not.toContainEqual(
      expect.objectContaining({ lastPaidOrderId: expect.anything() }),
    );
  });

  it("does not move the last paid order of a monthly plan either", async () => {
    m.verifyPolarWebhook.mockResolvedValue(upgradePaid());

    await post();

    expect(rowWrites()).not.toContainEqual(
      expect.objectContaining({ lastPaidOrderId: expect.anything() }),
    );
  });

  it("reports and acknowledges an upgrade without the old plan's credits", async () => {
    m.verifyPolarWebhook.mockResolvedValue(
      upgradePaid(undefined, { metadata: { projectId: PROJECT_ID } }),
    );

    const response = await post();

    expect(response.status).toBe(200);
    expect(grants()).toEqual([]);
    expect(m.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("Polar event ignored"),
      expect.anything(),
    );
  });
});

describe("POST /v1/webhooks/polar: a scheduled downgrade", () => {
  it("stores the downgrade as the pending product", async () => {
    m.verifyPolarWebhook.mockResolvedValue(
      subscriptionUpdated("2026-12-20T10:00:00.000Z", {
        pending_update: {
          id: "upd_1",
          applies_at: "2027-01-13T10:00:00.000Z",
          product_id: "prod_starter_month",
        },
      }),
    );

    await post();

    expect(rowWrites()).toEqual([
      expect.objectContaining({
        polarProductId: GROWTH.id,
        tier: "growth",
        pendingPolarProductId: "prod_starter_month",
      }),
    ]);
  });

  it("makes it the tier once Polar applies it", async () => {
    m.verifyPolarWebhook.mockResolvedValue(
      subscriptionUpdated("2027-01-13T10:00:02.000Z", {
        product_id: "prod_starter_month",
        product: {
          id: "prod_starter_month",
          name: "Starter",
          metadata: { kind: "plan", tier: "starter", credits: "10000" },
        },
        current_period_start: "2027-01-13T10:00:00.000Z",
        current_period_end: "2027-02-13T10:00:00.000Z",
      }),
    );

    await post();

    expect(rowWrites()).toEqual([
      expect.objectContaining({
        polarProductId: "prod_starter_month",
        tier: "starter",
        pendingPolarProductId: null,
      }),
    ]);
  });

  it("grants the new amount at the renewal after it", async () => {
    m.verifyPolarWebhook.mockResolvedValue(
      ok({
        type: "order.paid",
        timestamp: "2027-01-13T10:00:05.000Z",
        data: {
          id: "order_4",
          billing_reason: "subscription_cycle",
          metadata: {},
          customer: { id: "cus_1", external_id: ORGANIZATION_ID },
          product: {
            id: "prod_starter_month",
            name: "Starter",
            metadata: { kind: "plan", tier: "starter", credits: "10000" },
          },
          subscription: {
            ...SUBSCRIPTION,
            product_id: "prod_starter_month",
            current_period_start: "2027-01-13T10:00:00.000Z",
            current_period_end: "2027-02-13T10:00:00.000Z",
          },
          items: [],
        },
      }),
    );

    await post();

    expect(grants()).toMatchObject([
      { amount: 10_000n * CENTS_PER_CREDIT, referenceId: "order_4:0" },
    ]);
  });
});

describe("POST /v1/webhooks/polar: a kept plan", () => {
  it("keeps the tier and no pending product once Polar dropped the downgrade", async () => {
    m.verifyPolarWebhook.mockResolvedValue(
      subscriptionUpdated("2026-12-22T10:00:00.000Z", { pending_update: null }),
    );

    await post();

    expect(rowWrites()).toEqual([
      expect.objectContaining({
        polarProductId: GROWTH.id,
        tier: "growth",
        pendingPolarProductId: null,
      }),
    ]);
  });

  it("grants the current tier at the renewal, not the cleared downgrade", async () => {
    m.verifyPolarWebhook.mockResolvedValue(
      ok({
        type: "order.paid",
        timestamp: "2027-01-13T10:00:05.000Z",
        data: {
          id: "order_5",
          billing_reason: "subscription_cycle",
          metadata: {},
          customer: { id: "cus_1", external_id: ORGANIZATION_ID },
          product: GROWTH,
          subscription: {
            ...SUBSCRIPTION,
            current_period_start: "2027-01-13T10:00:00.000Z",
            current_period_end: "2027-02-13T10:00:00.000Z",
          },
          items: [],
        },
      }),
    );

    await post();

    expect(rowWrites()[0]).toMatchObject({
      polarProductId: GROWTH.id,
      tier: "growth",
    });
    expect(grants()).toMatchObject([
      { amount: 25_000n * CENTS_PER_CREDIT, referenceId: "order_5:0" },
    ]);
  });
});
