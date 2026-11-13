/**
 * Real-Postgres proof of free hiring (ADR 0068): while a Cuso has never had a
 * CMO subscription, holds no Starter credits and his strategy is not approved,
 * his turns cost nothing and may start in an organization with no credits.
 * A member's own Task in his Project is charged as before, and the one-unpaid-
 * Cuso rule finds the hirer's unpaid Cuso.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/cmo-free-hiring.postgres.test.ts
 *
 * Which Cusos are free is one relational filter, so mocked Prisma cannot show
 * it. Fixtures are committed and deleted after each test.
 */
import { randomUUID } from "node:crypto";
import { CreditBucketReferenceType, TaskStatus } from "@sokosumi/database";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { afterEach, describe, expect, it } from "vitest";

import { chargeTaskCreditsOrMarkOutOfCredits } from "@/helpers/task-event-charge";
import prisma from "@/lib/db/prisma";
import { findUnpaidCusoHiredBy } from "@/services/cmo-billing.service";
import {
  recordSokoBotTurnUsage,
  requireSokoBotTurnFunding,
} from "@/services/soko-bot-billing.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/** 10^10 ledger units are one credit. */
const CREDIT = 10_000_000_000n;
/** A cent of model cost: one credit at the default rate, inside a 10-credit pool. */
const TURN_COST_MICROS = 10_000n;

interface Seeded {
  userId: string;
  organizationId: string;
  workspaceId: string;
  projectId: string;
  sokoBotId: string;
}

const seeded: Seeded[] = [];

/** A hire: a member, his organization (pool credits optional) and Cuso. */
async function seedCuso(poolCredits = 0n): Promise<Seeded> {
  const suffix = randomUUID().slice(0, 8);
  const userId = `free-hiring-user-${suffix}`;
  const organizationId = `free-hiring-org-${suffix}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: "Free Hiring",
      email: `free-hiring-${suffix}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Free Hiring Org",
      slug: organizationId,
      members: { create: { userId, role: "owner" } },
    },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId },
    select: { id: true },
  });
  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      name: "acme.io",
      websiteUrl: "https://www.acme.io",
    },
    select: { id: true },
  });
  const bot = await prisma.sokoBot.create({
    data: {
      workspaceId: workspace.id,
      projectId: project.id,
      userId: null,
      createdByUserId: userId,
      versionId: CMO_SOKO_BOT_VERSION_IDS[0],
      name: "Cuso",
    },
    select: { id: true },
  });
  if (poolCredits > 0n) await grant(organizationId, poolCredits, null);
  const row = {
    userId,
    organizationId,
    workspaceId: workspace.id,
    projectId: project.id,
    sokoBotId: bot.id,
  };
  seeded.push(row);
  return row;
}

async function grant(
  organizationId: string,
  credits: bigint,
  projectId: string | null,
  bucket: {
    referenceType?: CreditBucketReferenceType;
    referenceNote?: string;
  } = {},
): Promise<void> {
  const amount = credits * CREDIT;
  await prisma.transaction.create({
    data: {
      amount,
      organizationId,
      sourceCreditBucket: {
        create: { amount, organizationId, projectId, ...bucket },
      },
    },
  });
}

async function approveStrategy(cuso: Seeded): Promise<void> {
  await prisma.marketingStrategy.create({
    data: { projectId: cuso.projectId, plan: {}, approvedAt: new Date() },
  });
}

async function subscribe(cuso: Seeded, endedAt: Date | null): Promise<void> {
  const now = new Date();
  await prisma.cmoSubscription.create({
    data: {
      projectId: cuso.projectId,
      organizationId: cuso.organizationId,
      polarSubscriptionId: `sub_${randomUUID()}`,
      polarProductId: "prod_starter",
      tier: "starter",
      interval: "month",
      status: endedAt ? "canceled" : "active",
      currentPeriodStart: now,
      currentPeriodEnd: now,
      endedAt,
      polarEventAt: now,
    },
  });
}

async function chargeTurn(cuso: Seeded) {
  return prisma.$transaction((tx) =>
    recordSokoBotTurnUsage(
      {
        turnId: randomUUID(),
        sokoBotId: cuso.sokoBotId,
        userId: null,
        costUsdMicros: TURN_COST_MICROS,
      },
      tx,
    ),
  );
}

afterEach(async () => {
  for (const row of seeded.splice(0)) {
    await prisma.sokoBotUsage.deleteMany({
      where: { sokoBotId: row.sokoBotId },
    });
    await prisma.transaction.deleteMany({
      where: { organizationId: row.organizationId },
    });
    await prisma.sokoBot.deleteMany({ where: { id: row.sokoBotId } });
    await prisma.project.deleteMany({ where: { id: row.projectId } });
    await prisma.workspace.deleteMany({ where: { id: row.workspaceId } });
    await prisma.organization.deleteMany({
      where: { id: row.organizationId },
    });
    await prisma.user.deleteMany({ where: { id: row.userId } });
  }
});

describe.skipIf(!enabled)("free hiring against PostgreSQL", () => {
  it("lets Cuso's turn start and charges nothing while he is being hired", async () => {
    const cuso = await seedCuso();

    await expect(
      requireSokoBotTurnFunding(cuso.userId, cuso.sokoBotId),
    ).resolves.toBeUndefined();
    await expect(
      requireSokoBotTurnFunding(null, cuso.sokoBotId),
    ).resolves.toBeUndefined();
    expect(await chargeTurn(cuso)).toMatchObject({
      chargedCents: 0n,
      shortfall: false,
    });
    expect(
      await prisma.sokoBotUsage.count({ where: { sokoBotId: cuso.sokoBotId } }),
    ).toBe(0);
  });

  it("charges a member's own Task in that Project as before", async () => {
    const cuso = await seedCuso(10n);

    const charge = await prisma.$transaction((tx) =>
      chargeTaskCreditsOrMarkOutOfCredits({
        userId: cuso.userId,
        organizationId: cuso.organizationId,
        projectId: cuso.projectId,
        cents: 2n * CREDIT,
        currentStatus: TaskStatus.RUNNING,
        tx,
      }),
    );

    expect(charge.transactionId).not.toBeNull();
    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { id: charge.transactionId ?? "" },
    });
    expect(transaction.amount).toBe(-2n * CREDIT);
  });

  it("ends once the strategy is approved", async () => {
    const empty = await seedCuso();
    await approveStrategy(empty);
    await expect(
      requireSokoBotTurnFunding(empty.userId, empty.sokoBotId),
    ).rejects.toThrow("Insufficient organization credits");

    const funded = await seedCuso(10n);
    await approveStrategy(funded);
    const charge = await chargeTurn(funded);
    expect(charge.chargedCents).toBeGreaterThan(0n);
    expect(charge.chargedCents).toBe(charge.expectedCents);
  });

  it("does not apply to a Cuso that ever had a CMO subscription", async () => {
    const cuso = await seedCuso(10n);
    await subscribe(cuso, new Date());

    expect((await chargeTurn(cuso)).chargedCents).toBeGreaterThan(0n);
  });

  it("does not apply to a Cuso hired with Starter credits", async () => {
    const cuso = await seedCuso();
    await grant(cuso.organizationId, 10_000n, cuso.projectId, {
      referenceType: CreditBucketReferenceType.FREE,
      referenceNote: `CMO.xyz starter credits (project ${cuso.projectId})`,
    });

    const charge = await chargeTurn(cuso);
    expect(charge.chargedCents).toBe(charge.expectedCents);
    expect(charge.chargedCents).toBeGreaterThan(0n);
  });

  it("finds the hirer's unpaid Cuso until his Project has a subscription", async () => {
    const cuso = await seedCuso();
    await approveStrategy(cuso);

    expect(await findUnpaidCusoHiredBy(cuso.userId)).toEqual({
      projectId: cuso.projectId,
      businessName: "acme.io",
    });
    expect(await findUnpaidCusoHiredBy(`someone-${randomUUID()}`)).toBeNull();

    await subscribe(cuso, new Date());
    expect(await findUnpaidCusoHiredBy(cuso.userId)).toBeNull();
  });
});
