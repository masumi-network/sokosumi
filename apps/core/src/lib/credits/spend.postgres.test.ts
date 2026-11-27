/**
 * The modes of a spend no payer uses yet, on a real PostgreSQL: a recorded
 * zero (Coworker usage) and a charge up to the balance (the Soko Bot). The
 * competitor check's mode is proven on its own entry point
 * (`src/services/competitor-check-spend.postgres.test.ts`).
 */
import { randomUUID } from "node:crypto";
import {
  creditBucketRepository,
  InsufficientBalanceError,
} from "@sokosumi/database/repositories";
import { afterAll, describe, expect, it, vi } from "vitest";

import { type SpendMode, spend } from "@/lib/credits/spend";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

/** Several transactions and reads on a loaded machine, past Vitest's 5 s. */
const CASE_TIMEOUT = 60_000;
const CLEANUP_TIMEOUT = 60_000;

const scope = createNetworkScope("mainnet");
const userIds: string[] = [];

/** A person with one bucket of personal credits. */
async function person(cents: bigint) {
  const userId = randomUUID();
  await prisma.user.create({
    data: {
      id: userId,
      name: "Spend modes fixture",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  userIds.push(userId);
  if (cents > 0n) {
    await scope.networkDb.transaction.create({
      data: {
        amount: cents,
        userId,
        sourceCreditBucket: { create: { amount: cents, userId } },
      },
    });
  }
  return { userId, organizationId: null, projectId: null };
}

type Payer = Awaited<ReturnType<typeof person>>;

function debits(payer: Payer) {
  return scope.networkDb.transaction.findMany({
    where: { userId: payer.userId, amount: { lte: 0n } },
    // Not by id: two ids of one millisecond have no order.
    orderBy: { amount: "desc" },
    select: {
      id: true,
      amount: true,
      creditConsumptions: { select: { amount: true } },
    },
  });
}

describe.skipIf(!enabled)("the modes of a spend (PostgreSQL)", () => {
  afterAll(async () => {
    const billedTo = { userId: { in: userIds } };
    await scope.networkDb.creditConsumption.deleteMany({
      where: { transaction: billedTo },
    });
    await scope.networkDb.creditBucket.deleteMany({ where: billedTo });
    await scope.networkDb.transaction.deleteMany({ where: billedTo });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }, CLEANUP_TIMEOUT);

  it(
    "records a price of zero as a debit of zero with no consumption",
    async () => {
      const payer = await person(90n);

      const zero = await scope.sharedTransaction(
        (tx) =>
          spend({
            scope,
            tx,
            payer,
            quotedCents: 0n,
            mode: "in_full_or_zero",
          }),
        "conflict",
        "Serializable",
      );

      expect(zero).toMatchObject({
        outcome: "recorded_zero",
        quotedCents: 0n,
        chargedCents: 0n,
        shortfall: false,
      });
      expect(await debits(payer)).toEqual([
        { id: zero.transactionId, amount: 0n, creditConsumptions: [] },
      ]);
    },
    CASE_TIMEOUT,
  );

  it(
    "charges what is left, then nothing from the emptied wallet",
    async () => {
      const payer = await person(90n);
      const upToBalance = () =>
        scope.sharedTransaction(
          (tx) =>
            spend({
              scope,
              tx,
              payer,
              quotedCents: 120n,
              mode: "up_to_balance" satisfies SpendMode,
            }),
          "conflict",
          "Serializable",
        );

      const partly = await upToBalance();
      const empty = await upToBalance();

      expect(partly).toMatchObject({
        outcome: "partly_charged",
        quotedCents: 120n,
        chargedCents: 90n,
        shortfall: true,
      });
      expect(empty).toEqual({
        outcome: "not_charged",
        transactionId: null,
        createdAt: null,
        quotedCents: 120n,
        chargedCents: 0n,
        shortfall: true,
        availableCents: 0n,
      });
      expect(await debits(payer)).toEqual([
        {
          id: partly.transactionId,
          amount: -90n,
          creditConsumptions: [{ amount: 90n }],
        },
      ]);
    },
    CASE_TIMEOUT,
  );

  it(
    "fails with the late error, not as an empty wallet, when a balance it read is gone before the buckets are chosen",
    async () => {
      const payer = await person(0n);
      // The two reads cannot disagree in one snapshot: only credits that
      // expire between their two clock readings do this.
      vi.spyOn(
        creditBucketRepository,
        "getNetworkBalance",
      ).mockResolvedValueOnce(90n);

      const thrown = await scope
        .sharedTransaction(
          (tx) =>
            spend({
              scope,
              tx,
              payer,
              quotedCents: 120n,
              mode: "up_to_balance",
            }),
          "conflict",
          "Serializable",
        )
        .catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(InsufficientBalanceError);
      expect(thrown).toMatchObject({
        message:
          "Insufficient balance: tried to consume 90 but only 0 available",
        requested: 90n,
        available: 0n,
      });
      expect(await debits(payer)).toEqual([]);
    },
    CASE_TIMEOUT,
  );
});
