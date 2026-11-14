/**
 * Real-Postgres proof that a Cuso's first CMO subscription webhook racing his
 * ending never leaves an active subscription on an ended Cuso (ADR 0068).
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/polar-subscription-end.postgres.test.ts
 *
 * An ending revokes what it finds, archives the Cuso, then revokes what the
 * Project still holds. The webhook writes the subscription before it checks
 * the Cuso, so whichever of the two checks second sees the other and
 * revokes. Fixtures are committed and deleted after.
 */
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { handlePolarSubscriptionEvent } from "./polar-subscription.service";
import {
  revokeCusoSubscription,
  revokeSubscriptionsLeftByEnding,
} from "./polar-subscription-end.service";

const m = vi.hoisted(() => ({ revokePolarSubscription: vi.fn() }));

vi.mock("@/clients/polar.client", () => ({
  revokePolarSubscription: m.revokePolarSubscription,
}));

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;

const ORGANIZATION = `org-${randomUUID()}`;
const WORKSPACE = randomUUID();
const DAY_MS = 86_400_000;
/** 10^10 ledger units are one credit. */
const CREDIT = 10_000_000_000n;

function database() {
  if (!db) throw new Error("Missing integration database");
  return db;
}

/** A Project with a live Cuso and no subscription yet: his checkout is open. */
async function hiredCuso() {
  const projectId = randomUUID();
  await database()
    .$executeRaw`INSERT INTO "project" ("id", "createdAt", "updatedAt", "workspaceId", "name") VALUES (${projectId}::uuid, NOW(), NOW(), ${WORKSPACE}::uuid, 'Cuso project')`;
  const bot = await database().sokoBot.create({
    data: {
      workspaceId: WORKSPACE,
      projectId,
      userId: null,
      versionId: CMO_SOKO_BOT_VERSION_IDS[0],
      name: "Cuso",
    },
    select: { id: true },
  });
  return {
    botId: bot.id,
    projectId,
    polarSubscriptionId: `sub-${randomUUID()}`,
  };
}

/** Polar's first event for the checkout he was paying when he ended. */
function subscriptionCreated(cuso: Awaited<ReturnType<typeof hiredCuso>>) {
  const now = Date.now();
  return {
    type: "subscription.created",
    timestamp: new Date(now).toISOString(),
    data: {
      id: cuso.polarSubscriptionId,
      status: "active",
      product_id: "prod_growth_month",
      product: {
        id: "prod_growth_month",
        metadata: { kind: "plan", tier: "growth", credits: "25000" },
      },
      recurring_interval: "month",
      current_period_start: new Date(now).toISOString(),
      current_period_end: new Date(now + 30 * DAY_MS).toISOString(),
      cancel_at_period_end: false,
      ended_at: null,
      pending_update: null,
      customer: { id: "cus_1", external_id: ORGANIZATION },
      metadata: {
        kind: "plan",
        projectId: cuso.projectId,
        organizationId: ORGANIZATION,
        userId: "user_1",
      },
    },
  } as unknown as Parameters<typeof handlePolarSubscriptionEvent>[0];
}

/** The ending's transaction, as an archive writes the Cuso's row. */
async function archive(botId: string) {
  await database().sokoBot.update({
    where: { id: botId },
    data: { archivedAt: new Date() },
  });
}

/** What is left of the Project's credits. */
async function left(projectId: string): Promise<bigint> {
  const buckets = await database().creditBucket.findMany({
    where: { projectId },
    select: { amount: true, consumptions: { select: { amount: true } } },
  });
  return buckets.reduce(
    (sum, bucket) =>
      sum +
      bucket.amount -
      bucket.consumptions.reduce((spent, c) => spent + c.amount, 0n),
    0n,
  );
}

async function stored(polarSubscriptionId: string) {
  return await database().polarSubscription.findUnique({
    where: { polarSubscriptionId },
    select: { status: true, endedAt: true },
  });
}

describe.skipIf(!db)(
  "a first CMO subscription racing its Cuso's ending",
  () => {
    beforeAll(async () => {
      if (!db) return;
      await db.$executeRaw`INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES (${ORGANIZATION}, 'Polar Org', ${ORGANIZATION}, NOW())`;
      await db.$executeRaw`INSERT INTO "workspace" ("id", "createdAt", "updatedAt", "userId", "organizationId") VALUES (${WORKSPACE}::uuid, NOW(), NOW(), NULL, ${ORGANIZATION})`;
    });

    beforeEach(() => {
      m.revokePolarSubscription.mockReset().mockResolvedValue(undefined);
    });

    afterAll(async () => {
      if (!db) return;
      await db.polarSubscription.deleteMany({
        where: { organizationId: ORGANIZATION },
      });
      // Buckets and consumptions go with their transactions.
      await db.transaction.deleteMany({
        where: { organizationId: ORGANIZATION },
      });
      await db.sokoBot.deleteMany({ where: { workspaceId: WORKSPACE } });
      await db.$executeRaw`DELETE FROM "project" WHERE "workspaceId" = ${WORKSPACE}::uuid`;
      await db.$executeRaw`DELETE FROM "workspace" WHERE "id" = ${WORKSPACE}::uuid`;
      await db.$executeRaw`DELETE FROM "organization" WHERE "id" = ${ORGANIZATION}`;
      await db.$disconnect();
    });

    it("revokes after the ending a subscription created after its first revoke", async () => {
      const cuso = await hiredCuso();

      // The ending finds nothing to revoke; the webhook still sees him live.
      await revokeCusoSubscription(cuso.botId);
      await handlePolarSubscriptionEvent(subscriptionCreated(cuso));
      expect((await stored(cuso.polarSubscriptionId))?.endedAt).toBeNull();
      await archive(cuso.botId);
      await revokeSubscriptionsLeftByEnding(cuso.projectId);

      expect(m.revokePolarSubscription).toHaveBeenCalledExactlyOnceWith(
        cuso.polarSubscriptionId,
      );
      expect(await stored(cuso.polarSubscriptionId)).toMatchObject({
        status: "canceled",
        endedAt: expect.any(Date),
      });
    });

    it("revokes in the webhook a subscription whose Cuso's ending committed first", async () => {
      const cuso = await hiredCuso();
      await revokeCusoSubscription(cuso.botId);
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      // The ending's transaction holds the Cuso's row as the webhook arrives.
      const ending = database().$transaction(async (tx) => {
        await tx.sokoBot.update({
          where: { id: cuso.botId },
          data: { archivedAt: new Date() },
        });
        await held;
      });
      const delivered = handlePolarSubscriptionEvent(subscriptionCreated(cuso));
      release();
      await ending;
      await delivered;
      await revokeSubscriptionsLeftByEnding(cuso.projectId);

      expect(m.revokePolarSubscription).toHaveBeenCalledExactlyOnceWith(
        cuso.polarSubscriptionId,
      );
      expect(await stored(cuso.polarSubscriptionId)).toMatchObject({
        status: "canceled",
        endedAt: expect.any(Date),
      });
    });

    it("writes off the credits a payment granted before the ending missed them", async () => {
      const cuso = await hiredCuso();
      await revokeCusoSubscription(cuso.botId);
      await handlePolarSubscriptionEvent(subscriptionCreated(cuso));
      // The payment's grant, which the archive's write-off did not see.
      await database().transaction.create({
        data: {
          amount: 25_000n * CREDIT,
          organizationId: ORGANIZATION,
          sourceCreditBucket: {
            create: {
              amount: 25_000n * CREDIT,
              expiresAt: new Date(Date.now() + 30 * DAY_MS),
              organizationId: ORGANIZATION,
              projectId: cuso.projectId,
              referenceId: `order-${randomUUID()}:0`,
              referenceType: "POLAR_SUBSCRIPTION_MONTH",
            },
          },
        },
      });
      await archive(cuso.botId);

      await revokeSubscriptionsLeftByEnding(cuso.projectId);

      expect(await left(cuso.projectId)).toBe(0n);
    });
  },
);
