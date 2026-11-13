/**
 * Real-Postgres proof that a refunded Polar order writes off what is left of
 * the credits it granted, once (ADR 0068).
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/routes/v1/webhooks/polar-refund.postgres.test.ts
 *
 * Mocked Prisma cannot show which buckets the write-off query leaves alone
 * (spent, expired, another order's), nor that two deliveries of one refund,
 * each on its own connection, write the rest off once instead of twice.
 * Fixtures are committed, so both connections see them, and deleted after.
 */
import { randomUUID } from "node:crypto";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createPrismaClient } from "@sokosumi/database/client";
import { ok } from "neverthrow";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";
import { syncCmoYearlyGrants } from "@/services/cmo-yearly-grant-sync.service";

import router from "./index";

const m = vi.hoisted(() => ({
  listPolarProducts: vi.fn(),
  verifyPolarWebhook: vi.fn(),
}));

vi.mock("@/clients/polar.client", () => ({
  listPolarProducts: m.listPolarProducts,
  verifyPolarWebhook: m.verifyPolarWebhook,
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(), verifyApiKey: vi.fn() } },
}));

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;

const ORGANIZATION = `org-${randomUUID()}`;
const WORKSPACE = randomUUID();
const PROJECT = randomUUID();

/** 10^10 ledger units are one credit. */
const CREDIT = 10_000_000_000n;
const NEXT_YEAR = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);

function database() {
  if (!db) throw new Error("Missing integration database");
  return db;
}

/** One bucket the order granted for a month, with part of it spent. */
async function grantMonth(
  orderId: string,
  monthIndex: number,
  { expiresAt = NEXT_YEAR, spent = 0n } = {},
): Promise<string> {
  const granted = await database().transaction.create({
    data: {
      amount: 25_000n * CREDIT,
      organizationId: ORGANIZATION,
      sourceCreditBucket: {
        create: {
          amount: 25_000n * CREDIT,
          expiresAt,
          organizationId: ORGANIZATION,
          projectId: PROJECT,
          referenceId: `${orderId}:${monthIndex}`,
          referenceType: "CMO_SUBSCRIPTION_MONTH",
        },
      },
    },
    select: { sourceCreditBucket: { select: { id: true } } },
  });
  const bucketId = granted.sourceCreditBucket?.id;
  if (!bucketId) throw new Error("The grant created no bucket");
  if (spent > 0n) {
    await database().transaction.create({
      data: {
        amount: -spent * CREDIT,
        organizationId: ORGANIZATION,
        creditConsumptions: { create: { amount: spent * CREDIT, bucketId } },
      },
    });
  }
  return bucketId;
}

/** Credits consumed from a bucket, one entry per spend or write-off. */
async function consumed(bucketId: string): Promise<bigint[]> {
  const rows = await database().creditConsumption.findMany({
    where: { bucketId },
    orderBy: { createdAt: "asc" },
    select: { amount: true },
  });
  return rows.map((row) => row.amount / CREDIT);
}

/** Delivers the refund of one order; each call takes its own connection. */
async function refund(orderId: string): Promise<number> {
  return await deliver({
    type: "order.refunded",
    timestamp: "2026-11-20T09:00:00.000Z",
    data: { id: orderId, metadata: {} },
  });
}

async function deliver(event: unknown): Promise<number> {
  m.verifyPolarWebhook.mockResolvedValueOnce(ok(event));
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "polar_refund_postgres_test");
    await next();
  });
  app.onError(errorHandler);
  app.route("/v1/webhooks", router);
  const response = await app.request("http://localhost/v1/webhooks/polar", {
    method: "POST",
    body: "{}",
  });
  return response.status;
}

describe.skipIf(!db)("order.refunded against PostgreSQL", () => {
  beforeAll(async () => {
    if (!db) return;
    await db.$executeRaw`INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES (${ORGANIZATION}, 'Polar Org', ${ORGANIZATION}, NOW())`;
    await db.$executeRaw`INSERT INTO "workspace" ("id", "createdAt", "updatedAt", "userId", "organizationId") VALUES (${WORKSPACE}::uuid, NOW(), NOW(), NULL, ${ORGANIZATION})`;
    await db.$executeRaw`INSERT INTO "project" ("id", "createdAt", "updatedAt", "workspaceId", "name") VALUES (${PROJECT}::uuid, NOW(), NOW(), ${WORKSPACE}::uuid, 'Cuso project')`;
  });

  afterAll(async () => {
    if (!db) return;
    await db.cmoSubscription.deleteMany({ where: { projectId: PROJECT } });
    // Buckets and consumptions go with their transactions.
    await db.transaction.deleteMany({
      where: { organizationId: ORGANIZATION },
    });
    await db.$executeRaw`DELETE FROM "project" WHERE "id" = ${PROJECT}::uuid`;
    await db.$executeRaw`DELETE FROM "workspace" WHERE "id" = ${WORKSPACE}::uuid`;
    await db.$executeRaw`DELETE FROM "organization" WHERE "id" = ${ORGANIZATION}`;
    await db.$disconnect();
  });

  it("writes off the rest of a partly spent grant and keeps what was spent", async () => {
    const orderId = `order-${randomUUID()}`;
    const bucketId = await grantMonth(orderId, 0, { spent: 7_000n });

    expect(await refund(orderId)).toBe(200);

    expect(await consumed(bucketId)).toEqual([7_000n, 18_000n]);
  });

  it("leaves a fully spent, an expired and another order's bucket alone", async () => {
    const orderId = `order-${randomUUID()}`;
    const spentId = await grantMonth(orderId, 0, { spent: 25_000n });
    const expiredId = await grantMonth(orderId, 1, { expiresAt: YESTERDAY });
    // Shares the refunded order's id as a prefix of its own.
    const otherId = await grantMonth(`${orderId}0`, 0);

    expect(await refund(orderId)).toBe(200);

    expect(await consumed(spentId)).toEqual([25_000n]);
    expect(await consumed(expiredId)).toEqual([]);
    expect(await consumed(otherId)).toEqual([]);
  });

  it("writes off every monthly grant of a yearly order", async () => {
    const orderId = `order-${randomUUID()}`;
    const months = [
      await grantMonth(orderId, 0, { spent: 25_000n }),
      await grantMonth(orderId, 1, { spent: 21_000n }),
      await grantMonth(orderId, 11),
    ];

    expect(await refund(orderId)).toBe(200);

    expect(await Promise.all(months.map(consumed))).toEqual([
      [25_000n],
      [21_000n, 4_000n],
      [25_000n],
    ]);
  });

  it("writes the rest off once when the refund is delivered twice at once", async () => {
    const orderId = `order-${randomUUID()}`;
    const bucketId = await grantMonth(orderId, 0, { spent: 7_000n });

    const statuses = await Promise.all([refund(orderId), refund(orderId)]);

    expect(statuses).toEqual([200, 200]);
    expect(await consumed(bucketId)).toEqual([7_000n, 18_000n]);
  });

  it("writes off nothing more when the refund is delivered again later", async () => {
    const orderId = `order-${randomUUID()}`;
    const bucketId = await grantMonth(orderId, 0);

    expect(await refund(orderId)).toBe(200);
    expect(await refund(orderId)).toBe(200);

    expect(await consumed(bucketId)).toEqual([25_000n]);
  });

  it("acknowledges a refund for an order that granted nothing", async () => {
    expect(await refund(`order-${randomUUID()}`)).toBe(200);
  });

  describe("a refunded yearly order", () => {
    const SUBSCRIPTION_ID = `sub-${randomUUID()}`;
    const ORDER = `order-${randomUUID()}`;
    const DAY = 24 * 60 * 60 * 1000;
    // Paid 40 days ago: the job is due to grant month 1.
    const PERIOD_START = new Date(Date.now() - 40 * DAY);
    const PERIOD_END = new Date(PERIOD_START.getTime() + 365 * DAY);
    const PRODUCT = {
      id: "prod_growth_year",
      name: "Growth yearly",
      is_recurring: true,
      recurring_interval: "year",
      recurring_interval_count: 1,
      metadata: { kind: "plan", tier: "growth", credits: "25000" },
      prices: [
        {
          amount_type: "fixed",
          is_archived: false,
          price_amount: 100,
          price_currency: "usd",
        },
      ],
    };

    async function row() {
      return await database().cmoSubscription.findUniqueOrThrow({
        where: { polarSubscriptionId: SUBSCRIPTION_ID },
        select: { lastPaidOrderId: true, lastPaidOrderRefundedAt: true },
      });
    }

    beforeAll(async () => {
      if (!db) return;
      m.listPolarProducts.mockResolvedValue([PRODUCT]);
      await db.cmoSubscription.create({
        data: {
          projectId: PROJECT,
          organizationId: ORGANIZATION,
          polarSubscriptionId: SUBSCRIPTION_ID,
          polarProductId: PRODUCT.id,
          tier: "growth",
          interval: "year",
          status: "active",
          currentPeriodStart: PERIOD_START,
          currentPeriodEnd: PERIOD_END,
          lastPaidOrderId: ORDER,
          lastPaidAt: PERIOD_START,
          polarEventAt: PERIOD_START,
        },
      });
      await grantMonth(ORDER, 0);
    });

    it("marks the subscription and grants no later month of it", async () => {
      expect(await refund(ORDER)).toBe(200);

      expect((await row()).lastPaidOrderRefundedAt).not.toBeNull();
      await syncCmoYearlyGrants(() => true);
      expect(
        await database().creditBucket.count({
          where: { referenceId: `${ORDER}:1` },
        }),
      ).toBe(0);
    });

    it("clears the mark when the next order is paid", async () => {
      const next = `order-${randomUUID()}`;
      const status = await deliver({
        type: "order.paid",
        timestamp: new Date().toISOString(),
        data: {
          id: next,
          billing_reason: "subscription_cycle",
          metadata: {},
          items: [],
          customer: { id: "cus_1", external_id: ORGANIZATION },
          product: PRODUCT,
          subscription: {
            id: SUBSCRIPTION_ID,
            status: "active",
            product_id: PRODUCT.id,
            recurring_interval: "year",
            current_period_start: PERIOD_END.toISOString(),
            current_period_end: new Date(
              PERIOD_END.getTime() + 365 * DAY,
            ).toISOString(),
            cancel_at_period_end: false,
            ended_at: null,
          },
        },
      });

      expect(status).toBe(200);
      expect(await row()).toEqual({
        lastPaidOrderId: next,
        lastPaidOrderRefundedAt: null,
      });
    });
  });
});
