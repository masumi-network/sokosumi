/**
 * SOK-905: delete remaining-0 leftover member: STRIPE_SUBSCRIPTION_PERIOD
 * tombstones only when a matching org fingerprint already exists.
 *
 * Run after mint paths skip via sentinel keys alone.
 *
 *   pnpm --filter @sokosumi/database data-migration:delete-member-period-tombstones
 *   pnpm --filter @sokosumi/database data-migration:delete-member-period-tombstones -- --dry-run
 *   pnpm --filter @sokosumi/database data-migration:delete-member-period-tombstones -- --organization-id <id>
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import { createPrismaClient } from "../src/client.js";
import { deleteCoveredMemberPeriodTombstones } from "../src/helpers/org-period-idempotency-sentinels.js";

loadEnv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

function parseArgs(argv: string[]): {
  dryRun: boolean;
  organizationId?: string;
} {
  let dryRun = false;
  let organizationId: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--organization-id") {
      organizationId = argv[index + 1];
      index += 1;
      continue;
    }
  }
  return { dryRun, organizationId };
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

  const { dryRun, organizationId } = parseArgs(process.argv.slice(2));
  const prisma = createPrismaClient(databaseUrl);
  try {
    console.log(
      dryRun
        ? "Dry run: counting covered member period tombstones…"
        : "Deleting covered remaining-0 member period tombstones…",
    );
    const result = await deleteCoveredMemberPeriodTombstones(prisma, {
      dryRun,
      organizationId,
    });
    console.log(
      `Member period tombstone delete ${dryRun ? "dry-run" : "done"}: candidates=${result.candidates} deleted=${result.deleted} skippedRemainingPositive=${result.skippedRemainingPositive} skippedUncovered=${result.skippedUncovered} skippedUnparseable=${result.skippedUnparseable}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
