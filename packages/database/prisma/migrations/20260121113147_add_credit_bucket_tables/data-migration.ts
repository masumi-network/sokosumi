/**
 * Data migration to backfill CreditBucket and CreditConsumption from existing Transaction data.
 *
 * This migration reconstructs buckets and consumptions in two phases:
 * - Phase 1: Create buckets from positive transactions (topups)
 * - Phase 2: Process negative transactions (spends) and create consumptions
 *
 * Validation: sum(bucket.amount) - sum(consumption.amount) = sum(transaction.amount)
 */


import "dotenv/config";

import { createPrismaClient } from "../../../src/client.js";

const prisma = createPrismaClient(process.env.DATABASE_URL as string);

async function main() {
  console.log("Starting credit bucket data migration...");

  // Phase 1: Create buckets from positive transactions (topups)
  console.log("Phase 1: Creating buckets from positive transactions...");

  // Get all positive transactions (one bucket per transaction)
  const positiveTransactions = await prisma.$queryRaw<
    Array<{
      userId: string;
      organizationId: string | null;
      referenceId: string | null;
      referenceType: string | null;
      amount: bigint;
      transactionId: string;
      createdAt: Date;
    }>
  >`
    SELECT 
      "userId",
      "organizationId",
      "referenceId",
      "referenceType",
      "amount",
      "id" as "transactionId",
      "createdAt"
    FROM "Transaction"
    WHERE "amount" > 0
    ORDER BY "createdAt" ASC
  `;

  console.log(
    `Found ${positiveTransactions.length} positive transactions to create buckets for`,
  );

  let bucketsCreated = 0;
  for (const transaction of positiveTransactions) {
    try {
      // Map TransactionReferenceType to CreditBucketReferenceType
      // Both enums have STRIPE_INVOICE, so we can map directly
      const referenceType =
        transaction.referenceType === "STRIPE_INVOICE"
          ? "STRIPE_INVOICE"
          : null;

      // Create one bucket per transaction
      // Note: If multiple transactions share the same referenceId/referenceType,
      // we'll skip duplicates due to the unique constraint
      await prisma.creditBucket.create({
        data: {
          createdAt: transaction.createdAt,
          amount: transaction.amount as bigint,
          expiresAt: null, // No expiration for historical data
          referenceId: transaction.referenceId,
          referenceType: referenceType,
          sourceTransactionId: transaction.transactionId,
          userId: transaction.userId,
          organizationId: transaction.organizationId,
        },
      });
      bucketsCreated++;
    } catch (error) {
      // If it's a unique constraint violation, skip (duplicate referenceId/referenceType)
      if (
        error instanceof Error &&
        error.message.includes("Unique constraint")
      ) {
        console.warn(
          `Skipping duplicate bucket for transaction ${transaction.transactionId} (referenceId: ${transaction.referenceId}, referenceType: ${transaction.referenceType})`,
        );
        continue;
      }
      console.error(
        `Error creating bucket for transaction ${transaction.transactionId} (user ${transaction.userId}, org ${transaction.organizationId}):`,
        error,
      );
      throw error;
    }
  }

  console.log(`Created ${bucketsCreated} buckets`);

  // Phase 2: Process negative transactions (spends) and create consumptions
  console.log("Phase 2: Processing negative transactions and creating consumptions...");

  // Get all negative transactions ordered chronologically
  const negativeTransactions = await prisma.transaction.findMany({
    where: {
      amount: { lt: 0 },
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
      userId: true,
      organizationId: true,
      amount: true,
      createdAt: true,
    },
  });

  console.log(`Found ${negativeTransactions.length} negative transactions to process`);

  let consumptionsCreated = 0;
  let totalConsumed = BigInt(0);

  for (const transaction of negativeTransactions) {
    const amountToConsume = -transaction.amount; // Convert to positive

    try {
      // Get all buckets for this user/organization in FIFO order
      const now = new Date();
      const buckets = await prisma.creditBucket.findMany({
        where: {
          userId: transaction.userId,
          organizationId: transaction.organizationId ?? null,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
        orderBy: [
          { expiresAt: { sort: "asc", nulls: "last" } },
          { createdAt: "asc" },
        ],
      });

      if (buckets.length === 0) {
        console.warn(
          `No buckets found for transaction ${transaction.id} (user: ${transaction.userId}, org: ${transaction.organizationId})`,
        );
        continue;
      }

      // Consume from buckets in FIFO order
      let remaining = amountToConsume;

      for (const bucket of buckets) {
        if (remaining <= BigInt(0)) {
          break;
        }

        // Calculate available balance for this bucket
        const consumptionSum = await prisma.creditConsumption.aggregate({
          where: { bucketId: bucket.id },
          _sum: { amount: true },
        });

        const consumed = consumptionSum._sum.amount ?? BigInt(0);
        const available = bucket.amount - consumed;

        if (available <= BigInt(0)) {
          continue; // Skip empty buckets
        }

        // Consume from this bucket (either all available or just what we need)
        const consumeFromBucket = available < remaining ? available : remaining;

        await prisma.creditConsumption.create({
          data: {
            createdAt: transaction.createdAt,
            amount: consumeFromBucket,
            bucketId: bucket.id,
            transactionId: transaction.id,
          },
        });

        consumptionsCreated++;
        totalConsumed += consumeFromBucket;
        remaining -= consumeFromBucket;
      }

      // Warn if we couldn't consume the full amount
      if (remaining > BigInt(0)) {
        console.warn(
          `Insufficient balance for transaction ${transaction.id}. Required: ${amountToConsume}, Consumed: ${amountToConsume - remaining}, Remaining: ${remaining}`,
        );
      }
    } catch (error) {
      console.error(
        `Error processing transaction ${transaction.id}:`,
        error,
      );
      throw error;
    }
  }

  console.log(`Created ${consumptionsCreated} consumptions`);
  console.log(`Total consumed: ${totalConsumed}`);

  // Validation: Check that sum(bucket.amount) - sum(consumption.amount) = sum(transaction.amount)
  console.log("Validating migration...");

  const bucketSum = await prisma.creditBucket.aggregate({
    _sum: { amount: true },
  });

  const consumptionSum = await prisma.creditConsumption.aggregate({
    _sum: { amount: true },
  });

  const transactionSum = await prisma.transaction.aggregate({
    _sum: { amount: true },
  });

  const totalBuckets = bucketSum._sum.amount ?? BigInt(0);
  const totalConsumptions = consumptionSum._sum.amount ?? BigInt(0);
  const totalTransactions = transactionSum._sum.amount ?? BigInt(0);

  const calculatedBalance = totalBuckets - totalConsumptions;
  const expectedBalance = totalTransactions;

  console.log(`Total bucket amount: ${totalBuckets}`);
  console.log(`Total consumption amount: ${totalConsumptions}`);
  console.log(`Calculated balance (buckets - consumptions): ${calculatedBalance}`);
  console.log(`Expected balance (sum of transactions): ${expectedBalance}`);

  if (calculatedBalance !== expectedBalance) {
    console.warn(
      `⚠️  Validation warning: Calculated balance (${calculatedBalance}) does not match expected balance (${expectedBalance}). Difference: ${calculatedBalance - expectedBalance}`,
    );
  } else {
    console.log("✅ Validation passed: Calculated balance matches expected balance");
  }

  console.log("Credit bucket data migration completed!");
}

main()
  .catch(async (e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
