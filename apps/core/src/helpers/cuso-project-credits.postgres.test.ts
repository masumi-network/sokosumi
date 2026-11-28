/**
 * Real-Postgres proof that ending a Cuso writes off every kind of Project
 * credits: plan grants and top-ups (ADR 0068) as well as Tester credits
 * (ADR 0067), and leaves the organization's pool alone.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/helpers/cuso-project-credits.postgres.test.ts
 *
 * The write-off is raw SQL, so mocked Prisma cannot show which buckets it
 * picks. Fixtures are committed and deleted after.
 */

import { randomUUID } from "node:crypto";
import { CreditBucketReferenceType } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import {
  createSqlTables,
  sqlTableLayoutFromEnv,
} from "@sokosumi/database/sql-tables";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeOff } from "@/lib/credits/write-off";
import { createNetworkScope } from "@/lib/db/network-scope";
import { testSchemaNames } from "@/test/split-layout";

const { sharedTable } = createSqlTables(sqlTableLayoutFromEnv(process.env));

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db =
  enabled && url
    ? createPrismaClient(url, {
        schema: testSchemaNames().DATABASE_SCHEMA_MAINNET,
      })
    : null;

const ORGANIZATION = `org-${randomUUID()}`;
const WORKSPACE = randomUUID();
const PROJECT = randomUUID();

/** 10^10 ledger units are one credit. */
const CREDIT = 10_000_000_000n;
const DAY = 86_400_000;

async function grant(
  referenceType: CreditBucketReferenceType,
  credits: bigint,
  projectId: string | null,
  dates?: { expiresAt: Date; createdAt: Date },
): Promise<string> {
  if (!db) throw new Error("Missing integration database");
  const amount = credits * CREDIT;
  const transaction = await db.transaction.create({
    data: {
      amount,
      organizationId: ORGANIZATION,
      userId: null,
      sourceCreditBucket: {
        create: {
          amount,
          expiresAt: null,
          organizationId: ORGANIZATION,
          projectId,
          referenceId: `${referenceType}-${randomUUID()}`,
          referenceType,
          userId: null,
          ...dates,
        },
      },
    },
    select: { sourceCreditBucket: { select: { id: true } } },
  });
  if (!transaction.sourceCreditBucket) throw new Error("No bucket created");
  return transaction.sourceCreditBucket.id;
}

async function remaining(bucketId: string): Promise<bigint> {
  if (!db) throw new Error("Missing integration database");
  const bucket = await db.creditBucket.findUniqueOrThrow({
    where: { id: bucketId },
    select: { amount: true, consumptions: { select: { amount: true } } },
  });
  return bucket.consumptions.reduce(
    (left, consumption) => left - consumption.amount,
    bucket.amount,
  );
}

describe.skipIf(!db)("a Project's write-off against PostgreSQL", () => {
  beforeAll(async () => {
    if (!db) return;
    await db.$executeRaw`INSERT INTO ${sharedTable("organization")} ("id", "name", "slug", "createdAt") VALUES (${ORGANIZATION}, 'Write-off Org', ${ORGANIZATION}, NOW())`;
    await db.$executeRaw`INSERT INTO ${sharedTable("workspace")} ("id", "createdAt", "updatedAt", "userId", "organizationId") VALUES (${WORKSPACE}::uuid, NOW(), NOW(), NULL, ${ORGANIZATION})`;
    await db.$executeRaw`INSERT INTO ${sharedTable("project")} ("id", "createdAt", "updatedAt", "workspaceId", "name") VALUES (${PROJECT}::uuid, NOW(), NOW(), ${WORKSPACE}::uuid, 'Cuso project')`;
  });

  afterAll(async () => {
    if (!db) return;
    // Buckets and consumptions go with their transactions.
    await db.transaction.deleteMany({
      where: { organizationId: ORGANIZATION },
    });
    await db.$executeRaw`DELETE FROM ${sharedTable("project")} WHERE "id" = ${PROJECT}::uuid`;
    await db.$executeRaw`DELETE FROM ${sharedTable("workspace")} WHERE "id" = ${WORKSPACE}::uuid`;
    await db.$executeRaw`DELETE FROM ${sharedTable("organization")} WHERE "id" = ${ORGANIZATION}`;
    await db.$disconnect();
  });

  it("writes off Project credits in expiry, creation and ID order, and keeps the pool", async () => {
    if (!db) throw new Error("Missing integration database");
    const now = Date.now();
    const soon = new Date(now + DAY);
    const later = new Date(now + 2 * DAY);
    const older = new Date(now - DAY);
    const newer = new Date(now);
    const plan = await grant(
      CreditBucketReferenceType.POLAR_SUBSCRIPTION_MONTH,
      25_000n,
      PROJECT,
    );
    const topUp = await grant(
      CreditBucketReferenceType.PROJECT_TOP_UP,
      5_000n,
      PROJECT,
      { expiresAt: soon, createdAt: newer },
    );
    const tester = await grant(
      CreditBucketReferenceType.CMO_TESTER_CREDITS,
      10_000n,
      PROJECT,
      { expiresAt: soon, createdAt: older },
    );
    const tied = await grant(
      CreditBucketReferenceType.PROJECT_TOP_UP,
      3n,
      PROJECT,
      { expiresAt: soon, createdAt: older },
    );
    const laterTopUp = await grant(
      CreditBucketReferenceType.PROJECT_TOP_UP,
      2n,
      PROJECT,
      { expiresAt: later, createdAt: older },
    );
    const pool = await grant(CreditBucketReferenceType.FREE, 700n, null);

    const writeOffs = await db.$transaction(async (tx) => {
      // The old query emits bucket ID order with a sorted aggregate.
      await tx.$executeRaw`SET LOCAL enable_hashagg = off`;
      await writeOff({
        scope: createNetworkScope("mainnet"),
        tx,
        of: { projectId: PROJECT },
      });
      return tx.creditConsumption.findMany({
        where: { transaction: { organizationId: ORGANIZATION } },
        orderBy: [
          { transaction: { createdAt: "asc" } },
          { transactionId: "asc" },
        ],
        select: { bucketId: true },
      });
    });

    expect(writeOffs.map(({ bucketId }) => bucketId)).toEqual([
      ...[tester, tied].sort(),
      topUp,
      laterTopUp,
      plan,
    ]);
    expect(await remaining(plan)).toBe(0n);
    expect(await remaining(topUp)).toBe(0n);
    expect(await remaining(tester)).toBe(0n);
    expect(await remaining(pool)).toBe(700n * CREDIT);
  });
});
