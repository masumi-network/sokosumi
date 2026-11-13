/**
 * Real-Postgres proof for Project top-ups (ADR 0068).
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/routes/v1/webhooks/polar-top-up.postgres.test.ts
 *
 * Mocked Prisma cannot show that two deliveries of one top-up order, each on
 * its own connection, end on the bucket's unique key instead of granting
 * twice, nor that the spend order SQL draws the month's plan credits before
 * the top-up. Fixtures are committed, so both connections see them, and
 * deleted after.
 */
import { randomUUID } from "node:crypto";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createPrismaClient } from "@sokosumi/database/client";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
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
const DAY_MS = 86_400_000;

const CHECKOUT = {
  metadata: {
    projectId: PROJECT,
    organizationId: ORGANIZATION,
    userId: "user-not-read",
  },
  customer: { id: "cus_1", external_id: ORGANIZATION },
};

function topUpPaid(orderId: string, paidAt = new Date()) {
  return ok({
    type: "order.paid",
    timestamp: paidAt.toISOString(),
    data: {
      ...CHECKOUT,
      id: orderId,
      billing_reason: "purchase",
      product: {
        id: "prod_top_up_5000",
        name: "5,000 credits",
        metadata: { kind: "top-up", credits: "5000" },
      },
      subscription: null,
    },
  });
}

/** The first order of a monthly plan whose month started today. */
function planPaid(orderId: string) {
  const now = Date.now();
  return ok({
    type: "order.paid",
    timestamp: new Date(now).toISOString(),
    data: {
      ...CHECKOUT,
      id: orderId,
      billing_reason: "subscription_create",
      product: {
        id: "prod_growth_month",
        name: "Growth",
        metadata: { kind: "plan", tier: "growth", credits: "25000" },
      },
      subscription: {
        id: SUBSCRIPTION_ID,
        status: "active",
        product_id: "prod_growth_month",
        recurring_interval: "month",
        current_period_start: new Date(now).toISOString(),
        current_period_end: new Date(now + 30 * DAY_MS).toISOString(),
        cancel_at_period_end: false,
        ended_at: null,
      },
    },
  });
}

/** Delivers one event; each call takes its own pooled connection. */
async function deliver(event: unknown): Promise<number> {
  m.verifyPolarWebhook.mockResolvedValueOnce(event);
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "polar_top_up_postgres_test");
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
    select: {
      id: true,
      amount: true,
      expiresAt: true,
      organizationId: true,
      projectId: true,
      referenceType: true,
    },
  });
}

describe.skipIf(!db)("Project top-ups against PostgreSQL", () => {
  beforeAll(async () => {
    if (!db) return;
    await db.$executeRaw`INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES (${ORGANIZATION}, 'Polar Org', ${ORGANIZATION}, NOW())`;
    await db.$executeRaw`INSERT INTO "workspace" ("id", "createdAt", "updatedAt", "userId", "organizationId") VALUES (${WORKSPACE}::uuid, NOW(), NOW(), NULL, ${ORGANIZATION})`;
    await db.$executeRaw`INSERT INTO "project" ("id", "createdAt", "updatedAt", "workspaceId", "name") VALUES (${PROJECT}::uuid, NOW(), NOW(), ${WORKSPACE}::uuid, 'Cuso project')`;
    // A live Cuso: credits are granted only to his Project.
    await db.sokoBot.create({
      data: {
        workspaceId: WORKSPACE,
        projectId: PROJECT,
        userId: null,
        versionId: CMO_SOKO_BOT_VERSION_IDS[0],
        name: "Cuso",
      },
    });
    // A top-up is granted only while the Cuso's subscription has not ended.
    await db.cmoSubscription.create({
      data: {
        projectId: PROJECT,
        organizationId: ORGANIZATION,
        polarSubscriptionId: SUBSCRIPTION_ID,
        polarProductId: "prod_growth_month",
        tier: "growth",
        interval: "month",
        status: "active",
        currentPeriodStart: new Date(Date.now() - DAY_MS),
        currentPeriodEnd: new Date(Date.now() + 29 * DAY_MS),
        polarEventAt: new Date(Date.now() - DAY_MS),
      },
    });
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

  it("grants one 12-month bucket when the same top-up is delivered twice at once", async () => {
    const orderId = `order-${randomUUID()}`;
    const paidAt = new Date("2026-11-13T10:00:05.000Z");

    const statuses = await Promise.all([
      deliver(topUpPaid(orderId, paidAt)),
      deliver(topUpPaid(orderId, paidAt)),
    ]);

    expect(statuses).toEqual([200, 200]);
    expect(await bucketsOf(orderId)).toEqual([
      {
        id: expect.any(String),
        amount: 5_000n * CREDIT,
        expiresAt: new Date("2027-11-13T10:00:05.000Z"),
        organizationId: ORGANIZATION,
        projectId: PROJECT,
        referenceType: "PROJECT_TOP_UP",
      },
    ]);
  });

  it("grants nothing more when the top-up is delivered again later", async () => {
    const orderId = `order-${randomUUID()}`;

    expect(await deliver(topUpPaid(orderId))).toBe(200);
    expect(await deliver(topUpPaid(orderId))).toBe(200);

    expect(await bucketsOf(orderId)).toHaveLength(1);
  });

  it("spends the month's plan credits before the top-up on a charge for the Project", async () => {
    if (!db) throw new Error("Missing integration database");
    // Clear what the tests above granted, so only these two buckets remain.
    await db.transaction.deleteMany({
      where: { organizationId: ORGANIZATION },
    });
    const topUpOrder = `order-${randomUUID()}`;
    const planOrder = `order-${randomUUID()}`;
    // The top-up lands first, so creation order cannot explain the result.
    expect(await deliver(topUpPaid(topUpOrder))).toBe(200);
    expect(await deliver(planPaid(planOrder))).toBe(200);
    const [plan] = await bucketsOf(planOrder);
    const [topUp] = await bucketsOf(topUpOrder);

    // More than the plan's month holds, so the charge reaches the top-up.
    const consumptions = await db.$transaction((tx) =>
      creditBucketRepository.prepareConsumption(
        null,
        ORGANIZATION,
        26_000n * CREDIT,
        tx,
        { projectId: PROJECT },
      ),
    );

    expect(consumptions).toEqual([
      { bucketId: plan?.id, amount: 25_000n * CREDIT },
      { bucketId: topUp?.id, amount: 1_000n * CREDIT },
    ]);
  });
});
