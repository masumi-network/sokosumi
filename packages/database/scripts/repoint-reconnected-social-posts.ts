/**
 * SOKO-5: move unsent social posts off a retired (disconnected) connection
 * onto the same account's active connection in the same Project.
 *
 * Disconnecting retires a row for good, so connecting the same account again
 * made a new row while unsent posts stayed on the retired one and kept asking
 * for a reconnect. Core now moves them on every connect; this repairs posts
 * stuck before that. Run after the Core release with the fix is serving, so
 * no old release can strand more posts behind it. Safe to run again.
 *
 *   pnpm --filter @sokosumi/database data-migration:repoint-reconnected-social-posts -- --dry-run
 *   pnpm --filter @sokosumi/database data-migration:repoint-reconnected-social-posts
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import { createPrismaClient } from "../src/client.js";

loadEnv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

// LinkedIn rows may hold the person URN instead of the bare id. The revision
// bump makes a publisher that read the retired connection lose its claim.
// A row a pending replace retired keeps its posts for that replace.
const CONNECTIONS = `"project_social_connection" AS retired,
     "project_social_connection" AS active`;
const STUCK_POST = `post."socialConnectionId" = retired."id"
  AND post."status" IN ('DRAFT', 'NEEDS_APPROVAL', 'SCHEDULED', 'FAILED', 'MISSED')
  AND retired."status" = 'disconnected'
  AND NOT EXISTS (
    SELECT 1 FROM "project_social_connection_intent" AS intent
    WHERE intent."socialConnectionId" = retired."id"
      AND intent."action" = 'replace'
      AND intent."expiresAt" > NOW()
  )
  AND active."projectId" = post."projectId"
  AND active."status" = 'active'
  AND active."provider" = retired."provider"
  AND (
    active."externalAccountId" = retired."externalAccountId"
    OR (
      retired."provider" = 'linkedin'
      AND regexp_replace(active."externalAccountId", '^urn:li:person:', '')
        = regexp_replace(retired."externalAccountId", '^urn:li:person:', '')
    )
  )`;

async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required (packages/database/.env, same as prisma migrate)",
    );
  }

  const dryRun = process.argv.slice(2).includes("--dry-run");
  const prisma = createPrismaClient(databaseUrl);
  try {
    if (dryRun) {
      const [row] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*) AS count
FROM "social_post" AS post, ${CONNECTIONS}
WHERE ${STUCK_POST}`,
      );
      console.log(`Dry run: ${row?.count ?? 0} stuck social post(s) to move.`);
      return;
    }
    const moved = await prisma.$executeRawUnsafe(
      `UPDATE "social_post" AS post
SET "socialConnectionId" = active."id",
    "revision" = post."revision" + 1,
    "updatedAt" = NOW()
FROM ${CONNECTIONS}
WHERE ${STUCK_POST}`,
    );
    console.log(
      `Moved ${moved} stuck social post(s) to the active connection.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
