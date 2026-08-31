/**
 * SOK-906: CreditBucket ownership is personal XOR organization.
 *
 *   pnpm --filter @sokosumi/database data-migration:credit-bucket-owner-xor
 *   pnpm --filter @sokosumi/database data-migration:credit-bucket-owner-xor -- --dry-run
 *   pnpm --filter @sokosumi/database data-migration:credit-bucket-owner-xor -- --verbose
 *   pnpm --filter @sokosumi/database data-migration:credit-bucket-owner-xor -- --organization-id <id>
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import { createPrismaClient } from "../src/client.js";
import { reconcileCreditBucketOwnerXor } from "../src/helpers/credit-bucket-owner-xor.js";

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
        ? "Dry run: classifying credit_bucket owner XOR rows…"
        : "Reconciling credit_bucket owner XOR…",
    );
    if (organizationId) {
      console.log(`Scoped to organizationId=${organizationId}`);
    }
    if (verbose) {
      console.log("Verbose debug logging enabled.");
    }
    const startedAt = Date.now();
    const result = await reconcileCreditBucketOwnerXor(prisma, {
      debug,
      dryRun,
      organizationId,
    });
    console.log(
      `Credit bucket owner XOR ${dryRun ? "dry-run" : "done"} in ${Date.now() - startedAt}ms: scanned=${result.scanned} drainedLeftoverMemberPeriod=${result.drainedLeftoverMemberPeriod} drainedLeftoverMemberPeriodCents=${result.drainedLeftoverMemberPeriodCents.toString()} deletedLeftoverMemberPeriod=${result.deletedLeftoverMemberPeriod} nulledDualOwnedOrgPeriod=${result.nulledDualOwnedOrgPeriod} nulledDualOwnedNonPeriod=${result.nulledDualOwnedNonPeriod} deletedBothNullRem0=${result.deletedBothNullRem0}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
