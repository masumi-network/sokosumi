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
import {
  CreditBucketReferenceType,
  Prisma,
} from "../src/generated/prisma/client.js";
import { ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX } from "../src/helpers/credit.js";
import { transferMemberPeriodBucketsToOrganizationPool } from "../src/helpers/organization-member-period-pool-transfer.js";

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
    const leftover = await prisma.creditBucket.findMany({
      where: {
        organizationId: { not: null },
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        referenceId: {
          startsWith: ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX,
        },
        userId: { not: null },
      },
      select: { organizationId: true },
      distinct: ["organizationId"],
    });
    const organizationIds = leftover
      .map((row) => row.organizationId)
      .filter((id): id is string => id != null);

    let organizations = 0;
    let bucketsDrained = 0;
    let centsTransferred = 0n;

    for (const organizationId of organizationIds) {
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
    }

    console.log(
      `Member period pool transfer: organizations=${organizations} bucketsDrained=${bucketsDrained} centsTransferred=${centsTransferred.toString()}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
