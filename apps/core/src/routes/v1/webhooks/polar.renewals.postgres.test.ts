/**
 * Real-Postgres proof for a CMO subscription after its first payment
 * (ADR 0068).
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/routes/v1/webhooks/polar.renewals.postgres.test.ts
 *
 * Mocked Prisma cannot show that a late renewal payment delivered twice at
 * once grants its month once, nor that a revoked subscription frees the
 * Project's one live row for the subscription of a new checkout. The cases
 * run in order on one subscription. Fixtures are committed and deleted after.
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
const NEXT_SUBSCRIPTION_ID = `sub-${randomUUID()}`;
const FIRST_ORDER = `order-${randomUUID()}`;
const RENEWAL_ORDER = `order-${randomUUID()}`;

/** 10^10 ledger units are one credit. */
const CREDIT = 10_000_000_000n;

const FIRST_MONTH = {
  id: SUBSCRIPTION_ID,
  status: "active",
  product_id: "prod_growth_month",
  recurring_interval: "month",
  current_period_start: "2026-11-13T10:00:00.000Z",
  current_period_end: "2026-12-13T10:00:00.000Z",
  cancel_at_period_end: false,
  ended_at: null,
};
const SECOND_MONTH = {
  ...FIRST_MONTH,
  current_period_start: "2026-12-13T10:00:00.000Z",
  current_period_end: "2027-01-13T10:00:00.000Z",
};
const CUSTOMER = { id: "cus_1", external_id: ORGANIZATION };
const PRODUCT = {
  id: FIRST_MONTH.product_id,
  name: "Growth",
  metadata: { kind: "plan", tier: "growth", credits: "25000" },
};
const CHECKOUT_METADATA = {
  projectId: PROJECT,
  organizationId: ORGANIZATION,
  userId: "user-not-read",
};

function orderPaid(
  timestamp: string,
  order: {
    id: string;
    billing_reason: string;
    metadata: Record<string, string>;
    subscription: typeof FIRST_MONTH;
  },
) {
  return ok({
    type: "order.paid",
    timestamp,
    data: { customer: CUSTOMER, product: PRODUCT, items: [], ...order },
  });
}

function subscriptionEvent(
  type: string,
  timestamp: string,
  subscription: Record<string, unknown>,
) {
  return ok({
    type,
    timestamp,
    data: {
      metadata: {},
      customer: CUSTOMER,
      product: PRODUCT,
      pending_update: null,
      ...subscription,
    },
  });
}

/** The renewal order of the second month, collected two days late. */
function lateRenewalPaid() {
  return orderPaid("2026-12-15T08:00:00.000Z", {
    id: RENEWAL_ORDER,
    billing_reason: "subscription_cycle",
    // A renewal order carries no checkout metadata.
    metadata: {},
    subscription: SECOND_MONTH,
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
    select: { amount: true, expiresAt: true, projectId: true },
  });
}

async function subscriptionRow(polarSubscriptionId: string) {
  if (!db) throw new Error("Missing integration database");
  return await db.cmoSubscription.findUnique({
    where: { polarSubscriptionId },
    select: {
      status: true,
      endedAt: true,
      lastPaidOrderId: true,
      projectId: true,
    },
  });
}

describe.skipIf(!db)(
  "POST /v1/webhooks/polar after the first payment, against PostgreSQL",
  () => {
    beforeAll(async () => {
      if (!db) return;
      await db.$executeRaw`INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES (${ORGANIZATION}, 'Polar Org', ${ORGANIZATION}, NOW())`;
      await db.$executeRaw`INSERT INTO "workspace" ("id", "createdAt", "updatedAt", "userId", "organizationId") VALUES (${WORKSPACE}::uuid, NOW(), NOW(), NULL, ${ORGANIZATION})`;
      await db.$executeRaw`INSERT INTO "project" ("id", "createdAt", "updatedAt", "workspaceId", "name") VALUES (${PROJECT}::uuid, NOW(), NOW(), ${WORKSPACE}::uuid, 'Cuso project')`;
      await deliver(
        orderPaid("2026-11-13T10:00:05.000Z", {
          id: FIRST_ORDER,
          billing_reason: "subscription_create",
          metadata: CHECKOUT_METADATA,
          subscription: FIRST_MONTH,
        }),
      );
    });

    afterAll(async () => {
      if (!db) return;
      // Buckets and the subscription rows go with their transaction and Project.
      await db.transaction.deleteMany({
        where: { organizationId: ORGANIZATION },
      });
      await db.$executeRaw`DELETE FROM "project" WHERE "id" = ${PROJECT}::uuid`;
      await db.$executeRaw`DELETE FROM "workspace" WHERE "id" = ${WORKSPACE}::uuid`;
      await db.$executeRaw`DELETE FROM "organization" WHERE "id" = ${ORGANIZATION}`;
      await db.$disconnect();
    });

    it("grants nothing while the renewal is past due", async () => {
      expect(
        await deliver(
          subscriptionEvent(
            "subscription.past_due",
            "2026-12-13T10:05:00.000Z",
            { ...SECOND_MONTH, status: "past_due" },
          ),
        ),
      ).toBe(200);

      expect(await bucketsOf(RENEWAL_ORDER)).toEqual([]);
      expect(await subscriptionRow(SUBSCRIPTION_ID)).toMatchObject({
        status: "past_due",
        endedAt: null,
        lastPaidOrderId: FIRST_ORDER,
      });
    });

    it("grants the month once when the late payment is delivered twice at once", async () => {
      const statuses = await Promise.all([
        deliver(lateRenewalPaid()),
        deliver(lateRenewalPaid()),
      ]);

      expect(statuses).toEqual([200, 200]);
      expect(await bucketsOf(RENEWAL_ORDER)).toEqual([
        {
          amount: 25_000n * CREDIT,
          expiresAt: new Date("2027-01-13T10:00:00.000Z"),
          projectId: PROJECT,
        },
      ]);
      expect(await subscriptionRow(SUBSCRIPTION_ID)).toMatchObject({
        status: "active",
        lastPaidOrderId: RENEWAL_ORDER,
      });
    });

    it("ends a revoked subscription and lets a new checkout's subscription take the Project", async () => {
      expect(
        await deliver(
          subscriptionEvent(
            "subscription.revoked",
            "2027-01-13T10:00:02.000Z",
            {
              ...SECOND_MONTH,
              status: "canceled",
              ended_at: "2027-01-13T10:00:00.000Z",
            },
          ),
        ),
      ).toBe(200);
      expect(
        await deliver(
          subscriptionEvent(
            "subscription.created",
            "2027-01-20T09:00:00.000Z",
            {
              ...FIRST_MONTH,
              id: NEXT_SUBSCRIPTION_ID,
              metadata: CHECKOUT_METADATA,
              current_period_start: "2027-01-20T09:00:00.000Z",
              current_period_end: "2027-02-20T09:00:00.000Z",
            },
          ),
        ),
      ).toBe(200);

      expect(await subscriptionRow(SUBSCRIPTION_ID)).toMatchObject({
        status: "canceled",
        endedAt: new Date("2027-01-13T10:00:00.000Z"),
      });
      expect(await subscriptionRow(NEXT_SUBSCRIPTION_ID)).toMatchObject({
        status: "active",
        endedAt: null,
        projectId: PROJECT,
      });
    });
  },
);
