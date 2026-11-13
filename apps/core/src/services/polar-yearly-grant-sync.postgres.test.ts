/**
 * Real-Postgres run of the yearly grant job (ADR 0068): the months of a paid
 * year that no run granted are granted by the next run, once.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/polar-yearly-grant-sync.postgres.test.ts
 *
 * The job's tests use a Prisma fake; this runs its query, the grant's row
 * lock and the bucket key on PostgreSQL. Fixtures are committed and deleted
 * after.
 */
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import { getNextMonthlyPeriodEnd } from "@sokosumi/database/helpers";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { syncPolarYearlyGrants } from "./polar-yearly-grant-sync.service";

const m = vi.hoisted(() => ({ listPolarProducts: vi.fn() }));

vi.mock("@/clients/polar.client", () => ({
  listPolarProducts: m.listPolarProducts,
}));

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;

const ORGANIZATION = `org-${randomUUID()}`;
const WORKSPACE = randomUUID();
const PROJECT = randomUUID();
const ORDER = `order-${randomUUID()}`;
const DAY_MS = 86_400_000;
/** Paid 100 days ago: months 1 to 3 have started, none was granted. */
const PERIOD_START = new Date(Date.now() - 100 * DAY_MS);

const PRODUCT = {
  id: `prod-${randomUUID()}`,
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

function database() {
  if (!db) throw new Error("Missing integration database");
  return db;
}

describe.skipIf(!db)("the yearly grant job against PostgreSQL", () => {
  beforeAll(async () => {
    if (!db) return;
    m.listPolarProducts.mockResolvedValue([PRODUCT]);
    await db.$executeRaw`INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES (${ORGANIZATION}, 'Polar Org', ${ORGANIZATION}, NOW())`;
    await db.$executeRaw`INSERT INTO "workspace" ("id", "createdAt", "updatedAt", "userId", "organizationId") VALUES (${WORKSPACE}::uuid, NOW(), NOW(), NULL, ${ORGANIZATION})`;
    await db.$executeRaw`INSERT INTO "project" ("id", "createdAt", "updatedAt", "workspaceId", "name") VALUES (${PROJECT}::uuid, NOW(), NOW(), ${WORKSPACE}::uuid, 'Cuso project')`;
    await db.sokoBot.create({
      data: {
        workspaceId: WORKSPACE,
        projectId: PROJECT,
        userId: null,
        versionId: CMO_SOKO_BOT_VERSION_IDS[0],
        name: "Cuso",
      },
    });
    await db.polarSubscription.create({
      data: {
        kind: "CMO",
        projectId: PROJECT,
        organizationId: ORGANIZATION,
        polarSubscriptionId: `sub-${randomUUID()}`,
        polarProductId: PRODUCT.id,
        tier: "growth",
        interval: "year",
        status: "active",
        currentPeriodStart: PERIOD_START,
        currentPeriodEnd: new Date(PERIOD_START.getTime() + 365 * DAY_MS),
        lastPaidOrderId: ORDER,
        lastPaidAt: PERIOD_START,
        polarEventAt: PERIOD_START,
      },
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.transaction.deleteMany({
      where: { organizationId: ORGANIZATION },
    });
    // The subscription row and the bot go with their Project.
    await db.$executeRaw`DELETE FROM "project" WHERE "id" = ${PROJECT}::uuid`;
    await db.$executeRaw`DELETE FROM "workspace" WHERE "id" = ${WORKSPACE}::uuid`;
    await db.$executeRaw`DELETE FROM "organization" WHERE "id" = ${ORGANIZATION}`;
    await db.$disconnect();
  });

  it("grants every started month no run granted, then nothing more", async () => {
    const before = new Date();
    await syncPolarYearlyGrants(() => true);
    const after = new Date();

    // Other files' rows may share the database: count this order's buckets.
    const buckets = await database().creditBucket.findMany({
      where: { referenceId: { startsWith: `${ORDER}:` } },
      orderBy: { referenceId: "asc" },
      select: { referenceId: true, expiresAt: true },
    });
    expect(buckets.map((bucket) => bucket.referenceId)).toEqual([
      `${ORDER}:1`,
      `${ORDER}:2`,
      `${ORDER}:3`,
    ]);
    // Months 1 and 2 ended already: one month from the grant.
    for (const bucket of buckets.slice(0, 2)) {
      expect(bucket.expiresAt?.getTime()).toBeGreaterThanOrEqual(
        getNextMonthlyPeriodEnd(before, before).getTime(),
      );
      expect(bucket.expiresAt?.getTime()).toBeLessThanOrEqual(
        getNextMonthlyPeriodEnd(after, after).getTime(),
      );
    }
    // Month 3 runs: its own end, after now.
    expect(buckets[2]?.expiresAt?.getTime()).toBeGreaterThan(after.getTime());

    await syncPolarYearlyGrants(() => true);
    expect(
      await database().creditBucket.count({
        where: { referenceId: { startsWith: `${ORDER}:` } },
      }),
    ).toBe(3);
  });
});
