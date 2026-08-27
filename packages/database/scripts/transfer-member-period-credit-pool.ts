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

    for (const [index, organizationId] of organizationIds.entries()) {
      const step = `${index + 1}/${organizationIds.length}`;
      console.log(`[${step}] starting ${organizationId}`);
      const orgStartedAt = Date.now();
      const result = await prisma.$transaction(
        (tx) =>
          transferMemberPeriodBucketsToOrganizationPool(tx, organizationId),
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
      organizations += result.organizations;
      bucketsDrained += result.bucketsDrained;
      centsTransferred += result.centsTransferred;
      console.log(
        `[${step}] ${organizationId} ${result.bucketsDrained === 0 ? "skipped (no remaining)" : "transferred"} in ${Date.now() - orgStartedAt}ms bucketsDrained=${result.bucketsDrained} centsTransferred=${result.centsTransferred.toString()}`,
      );
    }

    console.log(
      `Member period pool transfer done: organizationsTransferred=${organizations} bucketsDrained=${bucketsDrained} centsTransferred=${centsTransferred.toString()}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
