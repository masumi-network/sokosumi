/**
 * SOK-905: backfill org-owned STRIPE_SUBSCRIPTION_PERIOD sentinels at exact
 * post-pool invoice / local-free referenceIds implied by leftover member: rows.
 *
 *   pnpm --filter @sokosumi/database data-migration:org-period-idempotency-sentinels
 *   pnpm --filter @sokosumi/database data-migration:org-period-idempotency-sentinels -- --dry-run
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
        ? "Dry run: counting org period idempotency sentinels…"
        : "Backfilling org period idempotency sentinels…",
    );
    const result = await backfillOrgPeriodIdempotencySentinels(prisma, {
      dryRun,
      organizationId,
    });
    console.log(
      `Org period idempotency sentinels ${dryRun ? "dry-run" : "done"}: scannedLeftovers=${result.scannedLeftovers} distinctFingerprints=${result.distinctFingerprints} created=${result.created} alreadyPresent=${result.alreadyPresent} skippedNoActor=${result.skippedNoActor} unparseable=${result.unparseable}`,
    );

    if (!dryRun) {
      const coverage = await assertSentinelsCoverLeftoverMemberPeriods(prisma, {
        organizationId,
      });
      if (coverage.isErr()) {
        console.error(
          `Coverage assert failed: unparseable=${coverage.error.unparseable} uncovered=${coverage.error.uncoveredReferenceIds.length}`,
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
          "Coverage assert passed for leftover member period fingerprints.",
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
