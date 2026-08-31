/**
 * SOK-905: backfill org-owned STRIPE_SUBSCRIPTION_PERIOD sentinels at exact
 * post-pool invoice / local-free referenceIds implied by leftover member: rows.
 *
 *   pnpm --filter @sokosumi/database data-migration:org-period-idempotency-sentinels
 *   pnpm --filter @sokosumi/database data-migration:org-period-idempotency-sentinels -- --dry-run
 *   pnpm --filter @sokosumi/database data-migration:org-period-idempotency-sentinels -- --verbose
 *   pnpm --filter @sokosumi/database data-migration:org-period-idempotency-sentinels -- --organization-id <id>
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import { createPrismaClient } from "../src/client.js";
import {
  assertSentinelsCoverLeftoverMemberPeriods,
  backfillOrgPeriodIdempotencySentinels,
} from "../src/helpers/org-period-idempotency-sentinels.js";

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
        ? "Dry run: counting org period idempotency sentinels…"
        : "Backfilling org period idempotency sentinels…",
    );
    if (organizationId) {
      console.log(`Scoped to organizationId=${organizationId}`);
    }
    if (verbose) {
      console.log("Verbose debug logging enabled.");
    }
    const startedAt = Date.now();
    const result = await backfillOrgPeriodIdempotencySentinels(prisma, {
      debug,
      dryRun,
      organizationId,
    });
    console.log(
      `Org period idempotency sentinels ${dryRun ? "dry-run" : "done"} in ${Date.now() - startedAt}ms: scannedLeftovers=${result.scannedLeftovers} distinctFingerprints=${result.distinctFingerprints} created=${result.created} alreadyPresent=${result.alreadyPresent} unparseable=${result.unparseable}`,
    );

    if (!dryRun) {
      const coverage = await assertSentinelsCoverLeftoverMemberPeriods(prisma, {
        debug,
        organizationId,
      });
      if (coverage.isErr()) {
        console.error(
          `Coverage assert failed: uncovered=${coverage.error.uncoveredReferenceIds.length} unparseable=${coverage.error.unparseable}`,
        );
        for (const referenceId of coverage.error.uncoveredReferenceIds.slice(
          0,
          20,
        )) {
          console.error(`  uncovered ${referenceId}`);
        }
        process.exitCode = 1;
      } else {
        console.log(
          "Coverage assert passed for parseable leftover member period fingerprints.",
        );
        if (coverage.value.unparseable > 0) {
          console.warn(
            `Warning: ${coverage.value.unparseable} leftover member: period row(s) are unparseable and were not fingerprinted. They stay in place (delete skips them). Triage with --verbose.`,
          );
          for (const referenceId of coverage.value.unparseableReferenceIds.slice(
            0,
            20,
          )) {
            console.warn(`  unparseable ${referenceId}`);
          }
        }
      }
    } else if (result.unparseable > 0) {
      console.warn(
        `Warning: ${result.unparseable} leftover member: period row(s) are unparseable and will not get sentinels.`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
