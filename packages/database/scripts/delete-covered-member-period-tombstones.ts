/**
 * SOK-905: delete remaining-0 leftover member: STRIPE_SUBSCRIPTION_PERIOD
 * tombstones only when a matching org fingerprint already exists.
 *
 * Run after mint paths skip via sentinel keys alone.
 *
 *   pnpm --filter @sokosumi/database data-migration:delete-member-period-tombstones
 *   pnpm --filter @sokosumi/database data-migration:delete-member-period-tombstones -- --dry-run
 *   pnpm --filter @sokosumi/database data-migration:delete-member-period-tombstones -- --verbose
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
  verbose: boolean;
} {
  let dryRun = false;
  let organizationId: string | undefined;
  let verbose = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--verbose" || arg === "-v") {
      verbose = true;
      continue;
    }
    if (arg === "--organization-id") {
      organizationId = argv[index + 1];
      index += 1;
      continue;
    }
  }
  return { dryRun, organizationId, verbose };
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

  const { dryRun, organizationId, verbose } = parseArgs(process.argv.slice(2));
  const debug = verbose
    ? (message: string) => {
        console.log(`[debug] ${message}`);
      }
    : undefined;
  const prisma = createPrismaClient(databaseUrl);
  try {
    console.log(
      dryRun
        ? "Dry run: counting covered member period tombstones…"
        : "Deleting covered remaining-0 member period tombstones…",
    );
    if (organizationId) {
      console.log(`Scoped to organizationId=${organizationId}`);
    }
    if (verbose) {
      console.log("Verbose debug logging enabled.");
    }
    const startedAt = Date.now();
    const result = await deleteCoveredMemberPeriodTombstones(prisma, {
      debug,
      dryRun,
      organizationId,
    });
    console.log(
      `Member period tombstone delete ${dryRun ? "dry-run" : "done"} in ${Date.now() - startedAt}ms: candidates=${result.candidates} deleted=${result.deleted} skippedRemainingPositive=${result.skippedRemainingPositive} skippedUncovered=${result.skippedUncovered} skippedUnparseable=${result.skippedUnparseable}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
