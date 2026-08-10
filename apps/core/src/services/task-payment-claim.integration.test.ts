/**
 * Opt-in Postgres integration for task payment claim money paths.
 *
 * Run with a migrated database:
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgres://… \
 *     pnpm --filter @sokosumi/core test src/services/task-payment-claim.integration.test.ts
 *
 * Covers real unique-index races, concurrent lease acquisition, and refund
 * idempotency — paths unit tests only exercise against mocks.
 */
import assert from "node:assert/strict";

import { TaskPaymentClaimStatus } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { ok } from "neverthrow";
import { afterAll, describe, it, vi } from "vitest";

const createPurchaseMock = vi.hoisted(() => vi.fn());
const resolvePurchaseMock = vi.hoisted(() => vi.fn());

vi.mock("@/clients/masumi-payment.client", () => ({
  paymentClient: () => ({
    createPurchaseFromMasumiTaskPayment: createPurchaseMock,
    resolveMasumiTaskPaymentPurchase: resolvePurchaseMock,
  }),
}));

const databaseUrl = process.env.DATABASE_URL;
const shouldRunDatabaseTests =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(databaseUrl?.startsWith("postgres"));

const describeDatabase = shouldRunDatabaseTests ? describe : describe.skip;
const prisma = databaseUrl?.startsWith("postgres")
  ? createPrismaClient(databaseUrl)
  : null;

const { processTaskPaymentClaim, refundFailedTaskPaymentClaim } = await import(
  "./task-payment-claim.service"
);

interface SeedContext {
  userId: string;
  transactionIds: string[];
  claimIds: string[];
}

const purchasePayload = {
  blockchainIdentifier: "aa00",
  agentIdentifier: "ab".repeat(28),
  sellerVkey: "cd".repeat(28),
  submitResultTime: "1775681853000",
  payByTime: "1775737949000",
  unlockTime: "1775763149000",
  externalDisputeUnlockTime: "1775784749000",
  inputHash: "ef".repeat(32),
  Amounts: [{ amount: "1000000", unit: "" }],
  identifierFromPurchaser: "aabbccddeeff00",
  paymentSourceType: "Web3CardanoV1" as const,
  metadata: JSON.stringify({ taskId: "task-claim-int", taskEventId: "evt" }),
};

async function seedUserAndDebit(
  suffix: string,
  debitAmount: bigint = -1_000_000_000_000n,
): Promise<{ userId: string; transactionId: string }> {
  assert.ok(prisma);

  const userId = `tpc-int-user-${suffix}`;
  const email = `tpc-int-${suffix}@example.test`;

  await prisma.$executeRaw`
    INSERT INTO "user" (
      "id",
      "name",
      "email",
      "emailVerified",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${userId},
      'Task Payment Claim Integration User',
      ${email},
      true,
      NOW(),
      NOW()
    )
  `;

  const transactions = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "Transaction" (
      "id",
      "createdAt",
      "updatedAt",
      "amount",
      "userId"
    )
    VALUES (
      gen_random_uuid()::text,
      NOW(),
      NOW(),
      ${debitAmount},
      ${userId}
    )
    RETURNING "id"
  `;

  const transactionId = transactions[0]?.id;
  assert.ok(transactionId);

  return { userId, transactionId };
}

async function createPendingClaim(input: {
  network: string;
  blockchainIdentifier: string;
  transactionId: string;
  payloadBlockchainIdentifier?: string;
}): Promise<string> {
  assert.ok(prisma);

  const claim = await prisma.taskPaymentClaim.create({
    data: {
      network: input.network,
      blockchainIdentifier: input.blockchainIdentifier,
      purchasePayload: {
        ...purchasePayload,
        blockchainIdentifier:
          input.payloadBlockchainIdentifier ?? input.blockchainIdentifier,
      },
      transactionId: input.transactionId,
      status: TaskPaymentClaimStatus.PENDING,
      nextAttemptAt: new Date(0),
    },
    select: { id: true },
  });
  return claim.id;
}

async function cleanupSeedContext(context: SeedContext): Promise<void> {
  assert.ok(prisma);

  if (context.claimIds.length > 0) {
    await prisma.taskPaymentClaimAction.deleteMany({
      where: { claimId: { in: context.claimIds } },
    });
    await prisma.taskPaymentClaim.deleteMany({
      where: { id: { in: context.claimIds } },
    });
  }

  // Refund buckets / refund transactions created by refundFailedTaskPaymentClaim
  const refundTxs = await prisma.transaction.findMany({
    where: {
      userId: context.userId,
      amount: { gt: 0 },
    },
    select: {
      id: true,
      sourceCreditBucket: { select: { id: true } },
    },
  });
  for (const refund of refundTxs) {
    if (refund.sourceCreditBucket) {
      await prisma.creditBucket.delete({
        where: { id: refund.sourceCreditBucket.id },
      });
    }
    await prisma.transaction.delete({ where: { id: refund.id } });
  }

  if (context.transactionIds.length > 0) {
    await prisma.transaction.deleteMany({
      where: { id: { in: context.transactionIds } },
    });
  }

  await prisma.$executeRaw`
    DELETE FROM "user"
    WHERE "id" = ${context.userId}
  `;
}

describeDatabase("task payment claims database integration", () => {
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("rejects a second claim for the same network + blockchainIdentifier", async () => {
    assert.ok(prisma);

    const suffix = crypto.randomUUID();
    const firstDebit = await seedUserAndDebit(`${suffix}-a`);
    const secondDebit = await seedUserAndDebit(`${suffix}-b`);
    const blockchainIdentifier = `claim-unique-${suffix}`;
    const context: SeedContext = {
      userId: firstDebit.userId,
      transactionIds: [firstDebit.transactionId, secondDebit.transactionId],
      claimIds: [],
    };

    try {
      const claimId = await createPendingClaim({
        network: "Preprod",
        blockchainIdentifier,
        transactionId: firstDebit.transactionId,
      });
      context.claimIds.push(claimId);

      await assert.rejects(
        () =>
          createPendingClaim({
            network: "Preprod",
            blockchainIdentifier,
            transactionId: secondDebit.transactionId,
          }),
        (error: unknown) => {
          assert.ok(
            error &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "P2002",
            "expected Prisma unique violation P2002",
          );
          return true;
        },
      );
    } finally {
      await cleanupSeedContext(context);
      await prisma.$executeRaw`
        DELETE FROM "user"
        WHERE "id" = ${secondDebit.userId}
      `;
    }
  });

  it("lets only one concurrent processor acquire a pending claim lease", async () => {
    assert.ok(prisma);

    const suffix = crypto.randomUUID();
    const debit = await seedUserAndDebit(suffix);
    const context: SeedContext = {
      userId: debit.userId,
      transactionIds: [debit.transactionId],
      claimIds: [],
    };

    createPurchaseMock.mockReset();
    resolvePurchaseMock.mockReset();
    // Slow remote so both processTaskPaymentClaim calls race on acquire.
    createPurchaseMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(ok({ id: `purchase-${suffix}` }));
          }, 50);
        }),
    );

    try {
      const claimId = await createPendingClaim({
        network: "Preprod",
        blockchainIdentifier: `claim-lease-${suffix}`,
        transactionId: debit.transactionId,
      });
      context.claimIds.push(claimId);

      const [first, second] = await Promise.all([
        processTaskPaymentClaim(claimId),
        processTaskPaymentClaim(claimId),
      ]);

      const outcomes = [first.status, second.status].sort();
      assert.deepEqual(outcomes, ["purchased", "skipped"]);
      assert.equal(
        createPurchaseMock.mock.calls.length,
        1,
        "remote purchase must run under exactly one lease",
      );

      const claim = await prisma.taskPaymentClaim.findUniqueOrThrow({
        where: { id: claimId },
      });
      assert.equal(claim.status, TaskPaymentClaimStatus.PURCHASED);
      assert.equal(claim.externalPurchaseId, `purchase-${suffix}`);
      assert.equal(claim.processingToken, null);
    } finally {
      await cleanupSeedContext(context);
    }
  });

  it("refunds a pending claim once under concurrent callers", async () => {
    assert.ok(prisma);

    const suffix = crypto.randomUUID();
    const debit = await seedUserAndDebit(suffix);
    const context: SeedContext = {
      userId: debit.userId,
      transactionIds: [debit.transactionId],
      claimIds: [],
    };

    try {
      const claimId = await createPendingClaim({
        network: "Preprod",
        blockchainIdentifier: `claim-refund-${suffix}`,
        transactionId: debit.transactionId,
      });
      context.claimIds.push(claimId);

      const [first, second] = await Promise.all([
        refundFailedTaskPaymentClaim(claimId, "integration concurrent refund"),
        refundFailedTaskPaymentClaim(claimId, "integration concurrent refund"),
      ]);

      assert.equal(
        Number(first) + Number(second),
        1,
        "exactly one concurrent refund should create compensation",
      );

      const claim = await prisma.taskPaymentClaim.findUniqueOrThrow({
        where: { id: claimId },
        include: {
          refundTransaction: {
            include: { sourceCreditBucket: true },
          },
        },
      });
      assert.equal(claim.status, TaskPaymentClaimStatus.REFUNDED);
      assert.ok(claim.refundTransactionId);
      assert.ok(claim.refundTransaction);
      assert.equal(claim.refundTransaction.amount, 1_000_000_000_000n);
      assert.ok(claim.refundTransaction.sourceCreditBucket);
      assert.equal(
        claim.refundTransaction.sourceCreditBucket.amount,
        1_000_000_000_000n,
      );
      assert.equal(
        claim.refundTransaction.sourceCreditBucket.referenceId,
        `task-payment:${claimId}`,
      );

      // Idempotent after terminal state.
      const third = await refundFailedTaskPaymentClaim(
        claimId,
        "integration concurrent refund",
      );
      assert.equal(third, false);
    } finally {
      await cleanupSeedContext(context);
    }
  });
});
