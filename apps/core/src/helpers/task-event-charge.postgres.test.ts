/**
 * Real-Postgres proof of who a Task charge is booked to (ADR 0057).
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/helpers/task-event-charge.postgres.test.ts
 *
 * The Owner is the transaction's member and spends what they can spend in
 * the Organization. Work without an Owner draws on the Organization pool with
 * no member. The bucket scope is SQL, so only a real
 * database proves the charge lands on the right buckets. Every fixture is
 * written inside a transaction that always rolls back.
 */
import { TaskStatus } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import { chargeTaskCreditsOrMarkOutOfCredits } from "./task-event-charge";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;

afterAll(async () => {
  await db?.$disconnect();
});

const USER_ID = "tcharge-user";
const ORGANIZATION_ID = "tcharge-org";

type Tx = Parameters<Parameters<NonNullable<typeof db>["$transaction"]>[0]>[0];

class Rollback extends Error {}

async function withRollback(run: (tx: Tx) => Promise<void>): Promise<void> {
  if (!db) throw new Error("database not configured");
  try {
    await db.$transaction(async (tx) => {
      await run(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** A free Organization with one member and 10 credits in its pool. */
async function seedOrganizationPool(tx: Tx): Promise<string> {
  await tx.user.create({
    data: {
      id: USER_ID,
      name: "Charge User",
      email: "tcharge@example.test",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await tx.organization.create({
    data: {
      id: ORGANIZATION_ID,
      name: "Charge Org",
      slug: "tcharge-org",
      members: { create: { userId: USER_ID, role: "member" } },
    },
  });
  const topUp = await tx.transaction.create({
    data: { amount: 10n * 10n ** 10n, organizationId: ORGANIZATION_ID },
    select: { id: true },
  });
  const bucket = await tx.creditBucket.create({
    data: {
      amount: 10n * 10n ** 10n,
      organizationId: ORGANIZATION_ID,
      sourceTransactionId: topUp.id,
    },
    select: { id: true },
  });
  return bucket.id;
}

describe.skipIf(!enabled)("chargeTaskCreditsOrMarkOutOfCredits", () => {
  it("books the Owner as the transaction's member", async () => {
    await withRollback(async (tx) => {
      const bucketId = await seedOrganizationPool(tx);

      const charge = await chargeTaskCreditsOrMarkOutOfCredits({
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
        cents: 2n * 10n ** 10n,
        currentStatus: TaskStatus.RUNNING,
        tx,
      });

      const transaction = await tx.transaction.findUniqueOrThrow({
        where: { id: charge.transactionId ?? "" },
        include: { creditConsumptions: true },
      });
      expect(transaction).toMatchObject({
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
        amount: -2n * 10n ** 10n,
      });
      expect(transaction.creditConsumptions).toEqual([
        expect.objectContaining({ bucketId, amount: 2n * 10n ** 10n }),
      ]);
    });
  });

  it("charges work without an Owner to the Organization pool with no member", async () => {
    await withRollback(async (tx) => {
      const bucketId = await seedOrganizationPool(tx);

      const charge = await chargeTaskCreditsOrMarkOutOfCredits({
        userId: null,
        organizationId: ORGANIZATION_ID,
        cents: 3n * 10n ** 10n,
        currentStatus: TaskStatus.RUNNING,
        tx,
      });

      expect(charge.eventStatus).toBeNull();
      const transaction = await tx.transaction.findUniqueOrThrow({
        where: { id: charge.transactionId ?? "" },
        include: { creditConsumptions: true },
      });
      expect(transaction).toMatchObject({
        userId: null,
        organizationId: ORGANIZATION_ID,
        amount: -3n * 10n ** 10n,
      });
      expect(transaction.creditConsumptions).toEqual([
        expect.objectContaining({ bucketId, amount: 3n * 10n ** 10n }),
      ]);
    });
  });

  it("pauses work without an Owner when the Organization pool runs dry", async () => {
    await withRollback(async (tx) => {
      await seedOrganizationPool(tx);

      const charge = await chargeTaskCreditsOrMarkOutOfCredits({
        userId: null,
        organizationId: ORGANIZATION_ID,
        cents: 11n * 10n ** 10n,
        currentStatus: TaskStatus.RUNNING,
        tx,
      });

      expect(charge).toEqual({
        transactionId: null,
        eventStatus: TaskStatus.OUT_OF_CREDITS,
      });
    });
  });
});
