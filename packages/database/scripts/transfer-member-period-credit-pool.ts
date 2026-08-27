/**
 * SOK-892: transfer leftover member-keyed STRIPE_SUBSCRIPTION_PERIOD remaining
 * into one org-owned period bucket per organization. Keeps old rows.
 *
 *   pnpm data-migration:member-period-credit-pool
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import { createPrismaClient } from "../src/client.js";
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
    const result = await prisma.$transaction((tx) =>
      transferMemberPeriodBucketsToOrganizationPool(tx),
    );
    console.log(
      `Member period pool transfer: organizations=${result.organizations} bucketsDrained=${result.bucketsDrained} centsTransferred=${result.centsTransferred.toString()}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
