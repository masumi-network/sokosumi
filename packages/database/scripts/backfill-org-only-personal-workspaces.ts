/**
 * Temporary overlay (ADR 0010): create a personal workspace for every user
 * who has an organization membership and no personal workspace.
 *
 * Does not change preferredOrganizationId. Skips zero-workspace users.
 * No-op unless REQUIRE_PERSONAL_WORKSPACE=true.
 *
 *   pnpm data-migration:org-only-personal-workspaces
 */

import "dotenv/config";

import { createPrismaClient } from "../src/client.js";
import { backfillPersonalWorkspacesForOrgOnlyUsers } from "../src/helpers/org-only-personal-workspace-backfill.js";

async function main(): Promise<void> {
  const required =
    process.env.REQUIRE_PERSONAL_WORKSPACE?.trim().toLowerCase() === "true";
  if (!required) {
    console.log(
      "Skipped org-only personal workspace backfill (REQUIRE_PERSONAL_WORKSPACE is not true).",
    );
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
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
