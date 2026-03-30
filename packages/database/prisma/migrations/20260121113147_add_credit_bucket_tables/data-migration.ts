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

const BATCH_SIZE = 2000;

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

  // Prepare bucket data and filter duplicates based on (referenceId, referenceType)
  // The unique constraint @@unique([referenceId, referenceType]) means:
  // - Multiple rows can have (null, null)
  // - But if both are set, the combination must be unique
  const bucketsToCreate: Array<{
    createdAt: Date;
    amount: bigint;
    expiresAt: null;
    referenceId: string | null;
    referenceType: "STRIPE_INVOICE" | null;
    sourceTransactionId: string;
    userId: string;
    organizationId: string | null;
  }> = [];

  // Track seen (referenceId, referenceType) pairs to detect duplicates
  const seenReferencePairs = new Set<string>();

  let duplicatesSkipped = 0;
  for (const transaction of positiveTransactions) {
    // Map TransactionReferenceType to CreditBucketReferenceType
    // Both enums have STRIPE_INVOICE, so we can map directly
    const referenceType =
      transaction.referenceType === "STRIPE_INVOICE" ? "STRIPE_INVOICE" : null;

    // Create key for (referenceId, referenceType) unique constraint
    // Only check uniqueness if both referenceId and referenceType are set
    // (null, null) combinations are allowed multiple times
    const referenceKey =
      referenceType && transaction.referenceId
        ? `${transaction.referenceId}:${referenceType}`
        : null;

    // Check if we already have a bucket with this (referenceId, referenceType)
    // If so, skip this transaction (keep the first one)
    if (referenceKey && seenReferencePairs.has(referenceKey)) {
      duplicatesSkipped++;
      console.warn(
        `Skipping duplicate bucket for transaction ${transaction.transactionId} (referenceId: ${transaction.referenceId}, referenceType: ${referenceType})`,
      );
      continue;
    }

    if (referenceKey) {
      seenReferencePairs.add(referenceKey);
    }

    bucketsToCreate.push({
      createdAt: transaction.createdAt,
      amount: transaction.amount as bigint,
      expiresAt: null, // No expiration for historical data
      referenceId: transaction.referenceId,
      referenceType: referenceType,
      sourceTransactionId: transaction.transactionId,
      userId: transaction.userId,
      organizationId: transaction.organizationId,
    });
  }

  if (duplicatesSkipped > 0) {
    console.log(
      `Filtered out ${duplicatesSkipped} duplicate buckets based on (referenceId, referenceType)`,
    );
  }

  console.log(
    `Prepared ${bucketsToCreate.length} unique buckets to create (from ${positiveTransactions.length} transactions)`,
  );

  // Batch insert buckets using createMany
  let bucketsCreated = 0;

  for (let i = 0; i < bucketsToCreate.length; i += BATCH_SIZE) {
    const batch = bucketsToCreate.slice(i, i + BATCH_SIZE);
    try {
      await prisma.creditBucket.createMany({
        data: batch,
        skipDuplicates: true, // Skip if sourceTransactionId already exists (safety net)
      });
      bucketsCreated += batch.length;
      console.log(
        `Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(bucketsToCreate.length / BATCH_SIZE)}, total buckets: ${bucketsCreated}/${bucketsToCreate.length}`,
      );
    } catch (error) {
      console.error(
        `Error creating bucket batch ${Math.floor(i / BATCH_SIZE) + 1}:`,
        error,
      );
      throw error;
    }
  }

  console.log(`Created ${bucketsCreated} buckets`);

  // Phase 2: Process negative transactions (spends) and create consumptions
  console.log(
    "Phase 2: Processing negative transactions and creating consumptions...",
  );

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

  console.log(
    `Found ${negativeTransactions.length} negative transactions to process`,
  );

  // Step 1: Group transactions by (userId, organizationId)
  const transactionGroups = new Map<
    string,
    Array<{
      id: string;
      userId: string;
      organizationId: string | null;
      amount: bigint;
      createdAt: Date;
    }>
  >();

  for (const transaction of negativeTransactions) {
    const key = `${transaction.userId}:${transaction.organizationId ?? "null"}`;
    if (!transactionGroups.has(key)) {
      transactionGroups.set(key, []);
    }
    transactionGroups.get(key)!.push(transaction);
  }

  console.log(
    `Grouped ${negativeTransactions.length} transactions into ${transactionGroups.size} user/org groups`,
  );

  // Interface for bucket state tracking
  interface BucketState {
    id: string;
    amount: bigint;
    available: bigint; // Updated as consumptions are created
    expiresAt: Date | null;
    createdAt: Date;
  }

  let consumptionsCreated = 0;
  let totalConsumed = BigInt(0);
  const allConsumptionsToInsert: Array<{
    createdAt: Date;
    amount: bigint;
    bucketId: string;
    transactionId: string;
  }> = [];

  // Step 2: Process each group
  let groupIndex = 0;
  for (const [groupKey, groupTransactions] of transactionGroups) {
    groupIndex++;
    const [userId, orgIdStr] = groupKey.split(":");
    const organizationId = orgIdStr === "null" ? null : orgIdStr;

    try {
      // Get the earliest transaction time in this group for expiration filtering
      const earliestTransactionTime =
        groupTransactions[0]?.createdAt ?? new Date();

      // Query buckets once for this group with consumption sums pre-calculated
      // Build complete SQL string to avoid Prisma parameter binding issues
      const orgCondition = organizationId
        ? `cb."organizationId" = '${organizationId.replace(/'/g, "''")}'`
        : `cb."userId" = '${userId.replace(/'/g, "''")}' AND cb."organizationId" IS NULL`;

      // Format timestamp for SQL (escape single quotes)
      const timestampStr = earliestTransactionTime
        .toISOString()
        .replace(/'/g, "''");

      // Build complete SQL query string
      const sqlQuery = `
        SELECT 
          cb.id,
          cb.amount,
          COALESCE(SUM(cc.amount), 0)::bigint as consumed,
          (cb.amount - COALESCE(SUM(cc.amount), 0))::bigint as available,
          cb."expiresAt",
          cb."createdAt"
        FROM credit_bucket cb
        LEFT JOIN credit_consumption cc ON cc."bucketId" = cb.id
        WHERE 
          ${orgCondition}
          AND (cb."expiresAt" IS NULL OR cb."expiresAt" > '${timestampStr}'::timestamp)
        GROUP BY cb.id, cb.amount, cb."expiresAt", cb."createdAt"
        ORDER BY 
          cb."expiresAt" ASC NULLS LAST,
          cb."createdAt" ASC
      `;

      const buckets =
        await prisma.$queryRawUnsafe<
          Array<{
            id: string;
            amount: bigint;
            consumed: bigint;
            available: bigint;
            expiresAt: Date | null;
            createdAt: Date;
          }>
        >(sqlQuery);

      if (buckets.length === 0) {
        console.warn(
          `No buckets found for group ${groupIndex}/${transactionGroups.size} (user: ${userId}, org: ${organizationId})`,
        );
        // Still warn for each transaction in this group
        for (const transaction of groupTransactions) {
          console.warn(
            `No buckets found for transaction ${transaction.id} (user: ${transaction.userId}, org: ${transaction.organizationId})`,
          );
        }
        continue;
      }

      // Step 3: Create in-memory bucket state array (FIFO order)
      const bucketStates: BucketState[] = buckets.map((b) => ({
        id: b.id,
        amount: b.amount,
        available: b.available,
        expiresAt: b.expiresAt,
        createdAt: b.createdAt,
      }));

      // Step 4: Process transactions chronologically and update state
      for (const transaction of groupTransactions) {
        const amountToConsume = -transaction.amount; // Convert to positive
        let remaining = amountToConsume;

        for (const bucketState of bucketStates) {
          if (remaining <= BigInt(0)) break;
          if (bucketState.available <= BigInt(0)) continue;

          const consumeFromBucket =
            bucketState.available < remaining
              ? bucketState.available
              : remaining;

          allConsumptionsToInsert.push({
            createdAt: transaction.createdAt,
            amount: consumeFromBucket,
            bucketId: bucketState.id,
            transactionId: transaction.id,
          });

          // Update in-memory state
          bucketState.available -= consumeFromBucket;
          remaining -= consumeFromBucket;
        }

        // Warn if we couldn't consume the full amount
        if (remaining > BigInt(0)) {
          console.warn(
            `Insufficient balance for transaction ${transaction.id}. Required: ${amountToConsume}, Consumed: ${amountToConsume - remaining}, Remaining: ${remaining}`,
          );
        }
      }

      console.log(
        `Processed group ${groupIndex}/${transactionGroups.size} (user: ${userId}, org: ${organizationId ?? "null"}) - ${groupTransactions.length} transactions, ${buckets.length} buckets`,
      );
    } catch (error) {
      console.error(
        `Error processing group ${groupIndex}/${transactionGroups.size} (user: ${userId}, org: ${organizationId ?? "null"}):`,
        error,
      );
      // Continue processing other groups instead of failing completely
      throw error;
    }
  }

  // Step 5: Batch insert all consumptions
  console.log(
    `Batch inserting ${allConsumptionsToInsert.length} consumptions in batches of ${BATCH_SIZE}...`,
  );

  for (let i = 0; i < allConsumptionsToInsert.length; i += BATCH_SIZE) {
    const batch = allConsumptionsToInsert.slice(i, i + BATCH_SIZE);
    await prisma.creditConsumption.createMany({
      data: batch,
      skipDuplicates: true,
    });
    const batchConsumed = batch.reduce((sum, c) => sum + c.amount, BigInt(0));
    totalConsumed += batchConsumed;
    consumptionsCreated += batch.length;
    console.log(
      `Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allConsumptionsToInsert.length / BATCH_SIZE)}, total consumptions: ${consumptionsCreated}/${allConsumptionsToInsert.length}`,
    );
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
  console.log(
    `Calculated balance (buckets - consumptions): ${calculatedBalance}`,
  );
  console.log(`Expected balance (sum of transactions): ${expectedBalance}`);

  if (calculatedBalance !== expectedBalance) {
    console.warn(
      `⚠️  Validation warning: Calculated balance (${calculatedBalance}) does not match expected balance (${expectedBalance}). Difference: ${calculatedBalance - expectedBalance}`,
    );
  } else {
    console.log(
      "✅ Validation passed: Calculated balance matches expected balance",
    );
  }

  console.log("Credit bucket data migration completed!");
}

main()
  .catch(async (e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
