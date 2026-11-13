/**
 * Real-Postgres proof that a paid CMO plan order grants once (ADR 0068).
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/routes/v1/webhooks/polar.postgres.test.ts
 *
 * Mocked Prisma cannot show that two deliveries of one order, each on its own
 * connection, end on the bucket's unique key instead of granting twice, nor
 * that an older subscription payload leaves a newer stored state alone.
 * Fixtures are committed, so both connections see them, and deleted after.
 */
import { randomUUID } from "node:crypto";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createPrismaClient } from "@sokosumi/database/client";
import { ok } from "neverthrow";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;

const ORGANIZATION = `org-${randomUUID()}`;
const WORKSPACE = randomUUID();
const PROJECT = randomUUID();
const SUBSCRIPTION_ID = `sub-${randomUUID()}`;

/** 10^10 ledger units are one credit. */
const CREDIT = 10_000_000_000n;

const SUBSCRIPTION = {
  id: SUBSCRIPTION_ID,
  status: "active",
  product_id: "prod_growth_month",
  recurring_interval: "month",
  current_period_start: "2026-11-13T10:00:00.000Z",
  current_period_end: "2026-12-13T10:00:00.000Z",
  cancel_at_period_end: false,
  ended_at: null,
};
const CHECKOUT = {
  metadata: {
    projectId: PROJECT,
    organizationId: ORGANIZATION,
    userId: "user-not-read",
  },
  customer: { id: "cus_1", external_id: ORGANIZATION },
  product: {
    id: SUBSCRIPTION.product_id,
    name: "Growth",
    metadata: { kind: "plan", tier: "growth", credits: "25000" },
  },
};

function orderPaid(orderId: string) {
  return ok({
    type: "order.paid",
    timestamp: "2026-11-13T10:00:05.000Z",
    data: {
      ...CHECKOUT,
      id: orderId,
      billing_reason: "subscription_create",
      subscription: SUBSCRIPTION,
    },
  });
}

function subscriptionUpdated(timestamp: string, status: string) {
  return ok({
    type: "subscription.updated",
    timestamp,
    data: { ...CHECKOUT, ...SUBSCRIPTION, status, pending_update: null },
  });
}

/** Delivers one event; each call takes its own pooled connection. */
async function deliver(event: unknown): Promise<number> {
  m.verifyPolarWebhook.mockResolvedValueOnce(event);
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "polar_webhook_postgres_test");
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

async function bucketsOf(orderId: string) {
  if (!db) throw new Error("Missing integration database");
  return await db.creditBucket.findMany({
    where: { referenceId: `${orderId}:0` },
    select: { amount: true, organizationId: true, projectId: true },
  });
}

describe.skipIf(!db)("POST /v1/webhooks/polar against PostgreSQL", () => {
  beforeAll(async () => {
    if (!db) return;
    await db.$executeRaw`INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES (${ORGANIZATION}, 'Polar Org', ${ORGANIZATION}, NOW())`;
    await db.$executeRaw`INSERT INTO "workspace" ("id", "createdAt", "updatedAt", "userId", "organizationId") VALUES (${WORKSPACE}::uuid, NOW(), NOW(), NULL, ${ORGANIZATION})`;
    await db.$executeRaw`INSERT INTO "project" ("id", "createdAt", "updatedAt", "workspaceId", "name") VALUES (${PROJECT}::uuid, NOW(), NOW(), ${WORKSPACE}::uuid, 'Cuso project')`;
  });

  afterAll(async () => {
    if (!db) return;
    // Buckets and the subscription row go with their transaction and Project.
    await db.transaction.deleteMany({
      where: { organizationId: ORGANIZATION },
    });
    await db.$executeRaw`DELETE FROM "project" WHERE "id" = ${PROJECT}::uuid`;
    await db.$executeRaw`DELETE FROM "workspace" WHERE "id" = ${WORKSPACE}::uuid`;
    await db.$executeRaw`DELETE FROM "organization" WHERE "id" = ${ORGANIZATION}`;
    await db.$disconnect();
  });

  it("grants one bucket when the same order is delivered twice at once", async () => {
    const orderId = `order-${randomUUID()}`;

    const statuses = await Promise.all([
      deliver(orderPaid(orderId)),
      deliver(orderPaid(orderId)),
    ]);

    expect(statuses).toEqual([200, 200]);
    expect(await bucketsOf(orderId)).toEqual([
      {
        amount: 25_000n * CREDIT,
        organizationId: ORGANIZATION,
        projectId: PROJECT,
      },
    ]);
    expect(
      await db?.cmoSubscription.findMany({
        where: { projectId: PROJECT },
        select: { polarSubscriptionId: true, lastPaidOrderId: true },
      }),
    ).toEqual([
      { polarSubscriptionId: SUBSCRIPTION_ID, lastPaidOrderId: orderId },
    ]);
  });

  it("grants nothing more when the order is delivered again later", async () => {
    const orderId = `order-${randomUUID()}`;

    expect(await deliver(orderPaid(orderId))).toBe(200);
    expect(await deliver(orderPaid(orderId))).toBe(200);

    expect(await bucketsOf(orderId)).toHaveLength(1);
  });

  it("keeps the newer subscription state when an older payload arrives after it", async () => {
    expect(
      await deliver(
        subscriptionUpdated("2026-11-20T10:00:00.000Z", "past_due"),
      ),
    ).toBe(200);
    expect(
      await deliver(subscriptionUpdated("2026-11-19T10:00:00.000Z", "active")),
    ).toBe(200);

    expect(
      await db?.cmoSubscription.findUnique({
        where: { polarSubscriptionId: SUBSCRIPTION_ID },
        select: { status: true, polarEventAt: true },
      }),
    ).toEqual({
      status: "past_due",
      polarEventAt: new Date("2026-11-20T10:00:00.000Z"),
    });
  });
});
