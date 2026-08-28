/**
 * SOK-892: transfer leftover member-keyed STRIPE_SUBSCRIPTION_PERIOD remaining
 * into org-owned period buckets (one per expiry). Keeps old rows.
 *
 *   pnpm --filter @sokosumi/database data-migration:member-period-credit-pool
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import { createPrismaClient } from "../src/client.js";
import { Prisma } from "../src/generated/prisma/client.js";
import {
  listOrganizationIdsWithLeftoverMemberPeriodRemaining,
  transferMemberPeriodBucketsToOrganizationPool,
} from "../src/helpers/organization-member-period-pool-transfer.js";

loadEnv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

const SERIALIZATION_RETRIES = 5;

function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}

async function transferOrganizationWithRetry(
  prisma: ReturnType<typeof createPrismaClient>,
  organizationId: string,
  step: string,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SERIALIZATION_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) =>
          transferMemberPeriodBucketsToOrganizationPool(tx, organizationId),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      lastError = error;
      if (!isSerializationFailure(error) || attempt === SERIALIZATION_RETRIES) {
        throw error;
      }
      console.log(
        `[${step}] ${organizationId} serialization conflict, retry ${attempt}/${SERIALIZATION_RETRIES}`,
      );
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required (packages/database/.env, same as prisma migrate)",
    );
  }

  const prisma = createPrismaClient(databaseUrl);
  try {
    console.log(
      "Connected. Listing organizations with remaining member: period credits…",
    );
    const scanStartedAt = Date.now();
    const organizationIds =
      await listOrganizationIdsWithLeftoverMemberPeriodRemaining(prisma);
    console.log(
      `Found ${organizationIds.length} organizations with remaining (${Date.now() - scanStartedAt}ms). Transferring one serializable transaction per org.`,
    );

    let organizations = 0;
    let bucketsDrained = 0;
    let centsTransferred = 0n;
    let skippedNoActor = 0;

    for (const [index, organizationId] of organizationIds.entries()) {
      const step = `${index + 1}/${organizationIds.length}`;
      console.log(`[${step}] starting ${organizationId}`);
      const orgStartedAt = Date.now();
      const result = await transferOrganizationWithRetry(
        prisma,
        organizationId,
        step,
      );
      organizations += result.organizations;
      bucketsDrained += result.bucketsDrained;
      centsTransferred += result.centsTransferred;
      skippedNoActor += result.skippedNoActor;
      const outcome =
        result.skippedNoActor > 0
          ? "skipped (no member to stamp the ledger)"
          : result.bucketsDrained === 0
            ? "skipped (no remaining)"
            : "transferred";
      console.log(
        `[${step}] ${organizationId} ${outcome} in ${Date.now() - orgStartedAt}ms bucketsDrained=${result.bucketsDrained} centsTransferred=${result.centsTransferred.toString()}`,
      );
    }

    console.log(
      `Member period pool transfer done: organizationsTransferred=${organizations} bucketsDrained=${bucketsDrained} centsTransferred=${centsTransferred.toString()} skippedNoActor=${skippedNoActor}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
