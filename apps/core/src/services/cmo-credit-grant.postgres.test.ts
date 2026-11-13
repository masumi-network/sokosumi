/**
 * Real-Postgres proof that a CMO grant and a Cuso ending that race each other
 * never leave credits on an ended Cuso's Project (ADR 0068).
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/cmo-credit-grant.postgres.test.ts
 *
 * An ending revokes (writes the subscription row) before its transaction
 * archives the Cuso and writes off his Project's credits. The grant locks the
 * row, so it either waits for the revoke and grants nothing, or commits first
 * and the ending writes its credits off. Each side runs on its own
 * connection; fixtures are committed and deleted after. On PGlite (one
 * backend) the two transactions take turns instead of blocking on the lock.
 */
import { randomUUID } from "node:crypto";
import { CreditBucketReferenceType } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { writeOffProjectCredits } from "@/helpers/cuso-project-credits";

import { grantCmoCredits } from "./cmo-credit-grant.service";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;

const ORGANIZATION = `org-${randomUUID()}`;
const WORKSPACE = randomUUID();
/** 10^10 ledger units are one credit. */
const CREDIT = 10_000_000_000n;
const DAY_MS = 86_400_000;

function database() {
  if (!db) throw new Error("Missing integration database");
  return db;
}

/** A Project with a live Cuso and his live monthly subscription. */
async function subscribedCuso() {
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
  const row = await database().cmoSubscription.create({
    data: {
      projectId,
      organizationId: ORGANIZATION,
      polarSubscriptionId: `sub-${randomUUID()}`,
      polarProductId: "prod_growth_month",
      tier: "growth",
      interval: "month",
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
      polarEventAt: new Date(),
    },
    select: { id: true },
  });
  return { botId: bot.id, projectId, subscriptionId: row.id };
}

function grantFor(cuso: { projectId: string; subscriptionId: string }) {
  return {
    amount: 25_000n * CREDIT,
    expiresAt: new Date(Date.now() + 30 * DAY_MS),
    organizationId: ORGANIZATION,
    projectId: cuso.projectId,
    referenceId: `order-${randomUUID()}:0`,
    referenceNote: "Growth",
    referenceType: CreditBucketReferenceType.CMO_SUBSCRIPTION_MONTH,
    subscription: { cmoSubscriptionId: cuso.subscriptionId },
  };
}

/** The revoke's write of the row, as `revokeSubscriptions` does it. */
async function revoke(subscriptionId: string) {
  const endedAt = new Date();
  await database().cmoSubscription.updateMany({
    where: { id: subscriptionId, endedAt: null },
    data: { status: "canceled", endedAt, polarEventAt: endedAt },
  });
}

/** The ending's transaction: archive the Cuso, write off his credits. */
async function endCuso(cuso: { botId: string; projectId: string }) {
  await database().$transaction(async (tx) => {
    await tx.sokoBot.update({
      where: { id: cuso.botId },
      data: { archivedAt: new Date() },
    });
    await writeOffProjectCredits(cuso.projectId, tx);
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

describe.skipIf(!db)("a CMO grant racing a Cuso ending", () => {
  beforeEach(async () => {
    if (!db) return;
    if ((await db.workspace.count({ where: { id: WORKSPACE } })) > 0) return;
    await db.$executeRaw`INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES (${ORGANIZATION}, 'Polar Org', ${ORGANIZATION}, NOW())`;
    await db.$executeRaw`INSERT INTO "workspace" ("id", "createdAt", "updatedAt", "userId", "organizationId") VALUES (${WORKSPACE}::uuid, NOW(), NOW(), NULL, ${ORGANIZATION})`;
  });

  afterAll(async () => {
    if (!db) return;
    await db.transaction.deleteMany({
      where: { organizationId: ORGANIZATION },
    });
    await db.$executeRaw`DELETE FROM "project" WHERE "workspaceId" = ${WORKSPACE}::uuid`;
    await db.$executeRaw`DELETE FROM "workspace" WHERE "id" = ${WORKSPACE}::uuid`;
    await db.$executeRaw`DELETE FROM "organization" WHERE "id" = ${ORGANIZATION}`;
    await db.$disconnect();
  });

  it("grants nothing when the revoke comes first", async () => {
    const cuso = await subscribedCuso();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The revoke holds the row while the payment arrives.
    const ending = database().$transaction(async (tx) => {
      const endedAt = new Date();
      await tx.cmoSubscription.update({
        where: { id: cuso.subscriptionId },
        data: { status: "canceled", endedAt, polarEventAt: endedAt },
      });
      await held;
    });
    const granted = grantCmoCredits(grantFor(cuso));
    release();
    await ending;
    await endCuso(cuso);

    expect(await granted).toBe("not_live");
    expect(
      await database().creditBucket.count({
        where: { projectId: cuso.projectId },
      }),
    ).toBe(0);
  });

  it("writes the grant off when the grant commits first", async () => {
    const cuso = await subscribedCuso();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = () => {};
    const holding = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // The grant holds the row while the Cuso is ended.
    const granted = grantCmoCredits(grantFor(cuso), async () => {
      locked();
      await held;
    });
    await holding;
    const ending = revoke(cuso.subscriptionId).then(() => endCuso(cuso));
    release();

    expect(await granted).toBe("granted");
    await ending;
    expect(await left(cuso.projectId)).toBe(0n);
  });

  it("grants nothing to a live subscription whose Cuso was archived", async () => {
    const cuso = await subscribedCuso();
    await database().sokoBot.update({
      where: { id: cuso.botId },
      data: { archivedAt: new Date() },
    });

    expect(await grantCmoCredits(grantFor(cuso))).toBe("not_live");
  });
});
