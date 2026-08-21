/**
 * Temporary overlay (ADR 0010): create a personal workspace for every user
 * who has an organization membership and no personal workspace.
 *
 * Loads DATABASE_URL from this package's `.env` (same as Prisma CLI).
 * Does not read Core env. Skips zero-workspace users.
 *
 *   pnpm data-migration:org-only-personal-workspaces
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import { createPrismaClient } from "../src/client.js";
import { backfillPersonalWorkspacesForOrgOnlyUsers } from "../src/helpers/org-only-personal-workspace-backfill.js";

loadEnv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});
// Same as Prisma CLI: ambient DATABASE_URL wins over this file.

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
    const result = await backfillPersonalWorkspacesForOrgOnlyUsers(prisma);
    console.log(
      `Org-only personal workspace backfill: considered=${result.considered} created=${result.created}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
